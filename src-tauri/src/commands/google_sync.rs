//! Google Workspace integration — one-button OAuth + sync.
//!
//! OAuth client credentials come from the environment (`GOOGLE_CLIENT_ID`,
//! `GOOGLE_CLIENT_SECRET`, loaded from `.env` at startup) — never typed into
//! the UI. Connecting runs the standard installed-app flow:
//!
//! 1. `google_connect` starts a loopback listener on 127.0.0.1:<random port>,
//!    opens the system browser on Google's consent screen (PKCE / S256),
//! 2. Google redirects back to the loopback with a one-time code,
//! 3. the code is exchanged for tokens, which are stored (with expiry) in
//!    `app_data_dir/google_tokens.json`,
//! 4. `sync_google_workspace` uses the stored token — refreshing it
//!    automatically when expired — so the user never sees a credential.
//!
//! Without env credentials the sync falls back to the simulated demo files,
//! clearly labeled as such.

use crate::state::AppState;
use base64::Engine as _;
use domain::ingestion_service::IngestionService;
use memory_engine::SourceType;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const TOKEN_FILE: &str = "google_tokens.json";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly";

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleSyncParams {
    pub query: String,
    pub sync_gmail: bool,
    pub sync_drive: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleSyncResult {
    pub success: bool,
    pub message: String,
    pub files_synced: u32,
    pub entities_extracted: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleAuthStatus {
    /// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET present in the environment.
    pub configured: bool,
    /// A stored token exists — the user has connected.
    pub connected: bool,
    pub email: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct StoredTokens {
    access_token: String,
    refresh_token: Option<String>,
    /// Unix seconds when the access token expires.
    expires_at: u64,
    email: Option<String>,
}

fn env_credentials() -> Option<(String, String)> {
    let id = std::env::var("GOOGLE_CLIENT_ID").ok()?;
    let secret = std::env::var("GOOGLE_CLIENT_SECRET").ok()?;
    if id.trim().is_empty() || secret.trim().is_empty() {
        return None;
    }
    Some((id, secret))
}

fn token_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?
        .join(TOKEN_FILE))
}

fn load_tokens(app: &AppHandle) -> Option<StoredTokens> {
    let raw = fs::read_to_string(token_path(app).ok()?).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_tokens(app: &AppHandle, tokens: &StoredTokens) -> Result<(), String> {
    let path = token_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(tokens).map_err(|e| e.to_string())?)
        .map_err(|e| format!("failed to store tokens: {e}"))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ─── Auth commands ───────────────────────────────────────────────────────────

/// Current connection state — drives the single-button UI.
#[tauri::command]
pub async fn google_auth_status(app_handle: AppHandle) -> Result<GoogleAuthStatus, String> {
    let tokens = load_tokens(&app_handle);
    Ok(GoogleAuthStatus {
        configured: env_credentials().is_some(),
        connected: tokens.is_some(),
        email: tokens.and_then(|t| t.email),
    })
}

/// Forget the stored tokens.
#[tauri::command]
pub async fn google_disconnect(app_handle: AppHandle) -> Result<(), String> {
    let path = token_path(&app_handle)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// One-click connect: browser consent → loopback redirect → token exchange.
#[tauri::command]
pub async fn google_connect(app_handle: AppHandle) -> Result<GoogleAuthStatus, String> {
    let (client_id, client_secret) = env_credentials().ok_or(
        "Google OAuth is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env \
         (see .env.example) and restart the app",
    )?;

    // PKCE verifier/challenge + CSRF state.
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(verifier.as_bytes()));
    let state_token = uuid::Uuid::new_v4().simple().to_string();

    // Loopback receiver on a random port.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("cannot open loopback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = reqwest::Url::parse_with_params(
        "https://accounts.google.com/o/oauth2/v2/auth",
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state_token.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;

    app_handle
        .opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("could not open the browser: {e}"))?;

    // Wait (up to 3 minutes) for Google to redirect back.
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(180), listener.accept())
        .await
        .map_err(|_| "Timed out waiting for the browser sign-in (3 min) — try again".to_string())?
        .map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; 4096];
    let n = socket.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let query_line = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/");

    let mut code = None;
    let mut returned_state = None;
    let mut oauth_error = None;
    if let Some(qs) = query_line.split_once('?').map(|(_, q)| q) {
        for pair in qs.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            match k {
                "code" => code = Some(percent_decode(v)),
                "state" => returned_state = Some(percent_decode(v)),
                "error" => oauth_error = Some(percent_decode(v)),
                _ => {}
            }
        }
    }

    let page = |title: &str, body: &str| {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n\
             <html><body style=\"font-family:sans-serif;background:#14171C;color:#E8EAED;\
             display:flex;align-items:center;justify-content:center;height:100vh;\">\
             <div style=\"text-align:center\"><h2>{title}</h2><p>{body}</p></div></body></html>"
        )
    };

    let result: Result<String, String> = match (code, oauth_error) {
        (_, Some(err)) => Err(format!("Google returned an error: {err}")),
        (None, None) => Err("No authorization code in the redirect".to_string()),
        (Some(_), None) if returned_state.as_deref() != Some(state_token.as_str()) => {
            Err("State mismatch — possible CSRF, aborting".to_string())
        }
        (Some(code), None) => Ok(code),
    };

    let response_page = match &result {
        Ok(_) => page("✓ Connected", "You can close this tab and return to the Risk Engine."),
        Err(e) => page("Connection failed", e),
    };
    let _ = socket.write_all(response_page.as_bytes()).await;
    let _ = socket.shutdown().await;
    let code = result?;

    // Exchange the code for tokens.
    let client = reqwest::Client::new();
    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: Option<u64>,
    }
    let token_resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("token exchange failed: {e}"))?;

    if !token_resp.status().is_success() {
        let body = token_resp.text().await.unwrap_or_default();
        return Err(format!("token exchange rejected: {body}"));
    }
    let tokens: TokenResponse = token_resp.json().await.map_err(|e| e.to_string())?;

    // Who connected? (best effort)
    #[derive(Deserialize)]
    struct UserInfo {
        email: Option<String>,
    }
    let email = match client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&tokens.access_token)
        .send()
        .await
    {
        Ok(resp) => resp.json::<UserInfo>().await.ok().and_then(|u| u.email),
        Err(_) => None,
    };

    let stored = StoredTokens {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: now_secs() + tokens.expires_in.unwrap_or(3600).saturating_sub(60),
        email: email.clone(),
    };
    save_tokens(&app_handle, &stored)?;

    Ok(GoogleAuthStatus { configured: true, connected: true, email })
}

/// Return a fresh access token, refreshing via the stored refresh_token
/// when the current one is expired.
async fn fresh_access_token(app: &AppHandle) -> Result<String, String> {
    let mut tokens = load_tokens(app).ok_or(
        "Not connected to Google — click “Connect Google Workspace” first",
    )?;

    if now_secs() < tokens.expires_at {
        return Ok(tokens.access_token);
    }

    let refresh = tokens.refresh_token.clone().ok_or(
        "Google session expired and no refresh token was stored — reconnect",
    )?;
    let (client_id, client_secret) =
        env_credentials().ok_or("GOOGLE_CLIENT_ID/SECRET missing from environment")?;

    #[derive(Deserialize)]
    struct RefreshResponse {
        access_token: String,
        expires_in: Option<u64>,
        refresh_token: Option<String>,
    }
    let resp = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("token refresh failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("token refresh rejected — reconnect. ({body})"));
    }
    let refreshed: RefreshResponse = resp.json().await.map_err(|e| e.to_string())?;

    tokens.access_token = refreshed.access_token.clone();
    tokens.expires_at = now_secs() + refreshed.expires_in.unwrap_or(3600).saturating_sub(60);
    if refreshed.refresh_token.is_some() {
        tokens.refresh_token = refreshed.refresh_token;
    }
    save_tokens(app, &tokens)?;
    Ok(refreshed.access_token)
}

// ─── Sync ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_google_workspace(
    params: GoogleSyncParams,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<GoogleSyncResult, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to get app data dir: {e}"))?;

    let sync_dir = app_data_dir.join("google_sync");
    fs::create_dir_all(&sync_dir).map_err(|e| format!("cannot create sync directory: {e}"))?;

    let ingestion = IngestionService::new(state.memory(), state.db.clone());
    let mut files_synced = 0;
    let mut entities_extracted = 0;

    // ── Demo mode: no OAuth app configured — simulate, clearly labeled ──
    if env_credentials().is_none() && load_tokens(&app_handle).is_none() {
        println!("[google_sync] no OAuth credentials configured — running simulated sync");
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let mut mock_files = Vec::new();
        if params.sync_gmail {
            let gmail_path = sync_dir.join("google_workspace_gmail_alert_santos.txt");
            let gmail_content = "From: logistics-manager@valemineracao.com\n\
                                 To: operations@sovereign-supply.com\n\
                                 Subject: URGENT: Santos Port operations strike\n\
                                 Date: 2026-07-02T10:15:00Z\n\n\
                                 Hi team,\n\
                                 We received notice that port workers in Port of Santos have gone on strike. All lithium carbonate shipments will be delayed for at least 14 days. We are attempting to re-route what we can through alternate channels, but expect disruption to your Rotterdam shipments.";
            fs::write(&gmail_path, gmail_content)
                .map_err(|e| format!("failed to write mock email: {e}"))?;
            mock_files.push((gmail_path, SourceType::Email));
        }
        if params.sync_drive {
            let drive_path = sync_dir.join("google_workspace_drive_inventory_report.txt");
            let drive_content = "Sovereign Supply Chain Q2 Inventory Report\n\
                                 Document Type: Internal Inventory Summary\n\
                                 Author: Google Drive Shared Folder Sync\n\n\
                                 Golden Tiger Warehouse holds approximately 25 days of Lucky Lotus Powder. However, Tijuana Depot has only 4 days of stock remaining for Stolen Rolex Crates due to Marshall Freight Lines backlog. Caesars Palace Vault has high reliance on Black Doug Distribution for counterfeit casino chips.";
            fs::write(&drive_path, drive_content)
                .map_err(|e| format!("failed to write mock drive file: {e}"))?;
            mock_files.push((drive_path, SourceType::Pdf));
        }

        for (path, source) in mock_files {
            let path_str = path.to_string_lossy().to_string();
            match ingestion.ingest_file(&path_str, source).await {
                Ok(job) => {
                    files_synced += 1;
                    entities_extracted += job.entities_extracted.unwrap_or(0) as u32;
                }
                Err(e) => println!("[google_sync] failed to ingest mock file {path_str}: {e}"),
            }
        }

        return Ok(GoogleSyncResult {
            success: true,
            message: format!(
                "Simulated sync (no GOOGLE_CLIENT_ID in .env) — ingested {files_synced} demo file(s)."
            ),
            files_synced,
            entities_extracted,
        });
    }

    // ── Real sync — stored token, auto-refreshed ──
    let access_token = fresh_access_token(&app_handle).await?;
    let client = reqwest::Client::new();

    if params.sync_gmail {
        let query_filter = if params.query.is_empty() {
            "subject:(supply OR risk OR port OR logistics OR invoice)"
        } else {
            &params.query
        };

        match client
            .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
            .query(&[("q", query_filter), ("maxResults", "5")])
            .bearer_auth(&access_token)
            .send()
            .await
        {
            Ok(resp) => {
                #[derive(Deserialize)]
                struct GmailMessageRef {
                    id: String,
                }
                #[derive(Deserialize)]
                struct GmailListResponse {
                    messages: Option<Vec<GmailMessageRef>>,
                }

                if let Ok(list) = resp.json::<GmailListResponse>().await {
                    if let Some(messages) = list.messages {
                        for msg_ref in messages {
                            let detail_url = format!(
                                "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}",
                                msg_ref.id
                            );
                            if let Ok(detail_resp) = client
                                .get(&detail_url)
                                .bearer_auth(&access_token)
                                .send()
                                .await
                            {
                                #[derive(Deserialize)]
                                struct GmailMessage {
                                    snippet: Option<String>,
                                }
                                if let Ok(msg) = detail_resp.json::<GmailMessage>().await {
                                    let snippet = msg.snippet.unwrap_or_default();
                                    let file_path =
                                        sync_dir.join(format!("gmail_{}.txt", msg_ref.id));
                                    fs::write(&file_path, &snippet).unwrap_or(());

                                    let path_str = file_path.to_string_lossy().to_string();
                                    if let Ok(job) =
                                        ingestion.ingest_file(&path_str, SourceType::Email).await
                                    {
                                        files_synced += 1;
                                        entities_extracted +=
                                            job.entities_extracted.unwrap_or(0) as u32;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => return Err(format!("Gmail API request failed: {e}")),
        }
    }

    if params.sync_drive {
        let drive_url =
            "https://www.googleapis.com/drive/v3/files?q=mimeType='text/plain'&pageSize=3";
        match client.get(drive_url).bearer_auth(&access_token).send().await {
            Ok(resp) => {
                #[derive(Deserialize)]
                struct DriveFileRef {
                    id: String,
                    name: String,
                }
                #[derive(Deserialize)]
                struct DriveListResponse {
                    files: Option<Vec<DriveFileRef>>,
                }

                if let Ok(list) = resp.json::<DriveListResponse>().await {
                    if let Some(files) = list.files {
                        for file_ref in files {
                            let download_url = format!(
                                "https://www.googleapis.com/drive/v3/files/{}?alt=media",
                                file_ref.id
                            );
                            if let Ok(dl_resp) =
                                client.get(&download_url).bearer_auth(&access_token).send().await
                            {
                                if let Ok(content) = dl_resp.text().await {
                                    let file_path =
                                        sync_dir.join(format!("drive_{}", file_ref.name));
                                    fs::write(&file_path, &content).unwrap_or(());

                                    let path_str = file_path.to_string_lossy().to_string();
                                    if let Ok(job) =
                                        ingestion.ingest_file(&path_str, SourceType::Pdf).await
                                    {
                                        files_synced += 1;
                                        entities_extracted +=
                                            job.entities_extracted.unwrap_or(0) as u32;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => return Err(format!("Google Drive API request failed: {e}")),
        }
    }

    Ok(GoogleSyncResult {
        success: true,
        message: format!("Google Workspace sync completed — {files_synced} file(s) ingested."),
        files_synced,
        entities_extracted,
    })
}
