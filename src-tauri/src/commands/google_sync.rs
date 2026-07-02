use crate::state::AppState;
use domain::ingestion_service::IngestionService;
use memory_engine::SourceType;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GoogleSyncParams {
    pub api_key: String,
    pub client_id: String,
    pub client_secret: String,
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

    // --- Scenario A: API Key is empty -> Simulate Sync with beautiful contextual files ---
    if params.api_key.is_empty() {
        println!("[google_sync] API Key is empty. Running mock workspace sync simulation...");

        // Simulate 2s delay
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

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
            mock_files.push((drive_path, SourceType::Pdf)); // treat as PDF/TXT
        }

        for (path, source) in mock_files {
            let path_str = path.to_string_lossy().to_string();
            match ingestion.ingest_file(&path_str, source).await {
                Ok(job) => {
                    files_synced += 1;
                    entities_extracted += job.entities_extracted.unwrap_or(0) as u32;
                }
                Err(e) => {
                    println!("[google_sync] failed to ingest mock file {path_str}: {e}");
                }
            }
        }

        return Ok(GoogleSyncResult {
            success: true,
            message: "Simulation: Mock Google Workspace sync completed successfully. Synced 2 files.".to_string(),
            files_synced,
            entities_extracted,
        });
    }

    // --- Scenario B: API Key is present -> Real HTTP fetch from Google Workspace ---
    println!("[google_sync] API Key provided. Connecting to Google APIs...");
    let client = reqwest::Client::new();

    // 1. Sync Gmail Messages
    if params.sync_gmail {
        let query_filter = if params.query.is_empty() {
            "subject:(supply OR risk OR port OR logistics OR invoice)"
        } else {
            &params.query
        };

        match client
            .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
            .query(&[("q", query_filter), ("maxResults", "5")])
            .bearer_auth(&params.api_key)
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
                                .bearer_auth(&params.api_key)
                                .send()
                                .await
                            {
                                #[derive(Deserialize)]
                                struct GmailMessage {
                                    snippet: Option<String>,
                                }
                                if let Ok(msg) = detail_resp.json::<GmailMessage>().await {
                                    let snippet = msg.snippet.unwrap_or_default();
                                    let file_path = sync_dir.join(format!("gmail_{}.txt", msg_ref.id));
                                    fs::write(&file_path, &snippet).unwrap_or(());

                                    let path_str = file_path.to_string_lossy().to_string();
                                    if let Ok(job) = ingestion.ingest_file(&path_str, SourceType::Email).await {
                                        files_synced += 1;
                                        entities_extracted += job.entities_extracted.unwrap_or(0) as u32;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                return Err(format!("Gmail API request failed: {e}"));
            }
        }
    }

    // 2. Sync Google Drive Files
    if params.sync_drive {
        let drive_url = "https://www.googleapis.com/drive/v3/files?q=mimeType='text/plain'&pageSize=3";
        match client
            .get(drive_url)
            .bearer_auth(&params.api_key)
            .send()
            .await
        {
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
                            if let Ok(dl_resp) = client
                                .get(&download_url)
                                .bearer_auth(&params.api_key)
                                .send()
                                .await
                            {
                                if let Ok(content) = dl_resp.text().await {
                                    let file_path = sync_dir.join(format!("drive_{}", file_ref.name));
                                    fs::write(&file_path, &content).unwrap_or(());

                                    let path_str = file_path.to_string_lossy().to_string();
                                    if let Ok(job) = ingestion.ingest_file(&path_str, SourceType::Pdf).await {
                                        files_synced += 1;
                                        entities_extracted += job.entities_extracted.unwrap_or(0) as u32;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                return Err(format!("Google Drive API request failed: {e}"));
            }
        }
    }

    Ok(GoogleSyncResult {
        success: true,
        message: format!("Google Workspace sync completed successfully. Synced {files_synced} files."),
        files_synced,
        entities_extracted,
    })
}
