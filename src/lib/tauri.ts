import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

// ─── Backend Types ────────────────────────────────────────────────────────────

export interface MemoryEntity {
  id: string;
  entity_type: string;
  name: string;
  attributes: Record<string, unknown>;
}

export interface MemoryRelationship {
  from_id: string;
  to_id: string;
  relationship_type: string;
  weight: number;
  active: boolean;
}

export interface BackendQueryResult {
  answer: string;
  reasoning_path: MemoryEntity[];
  confidence: 'High' | 'Partial' | 'Low';
}

export interface GraphSnapshot {
  entities: MemoryEntity[];
  relationships: MemoryRelationship[];
}

export interface IngestionJob {
  id: string;
  file_path: string;
  source_type: string;
  status: string;
  entities_extracted: number | null;
  relationships_extracted: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CorrectionEntry {
  id: string;
  raw_text: string;
  author: string;
  status: string;
  audit_node_id: string | null;
  created_at: string;
}

export interface CorrectionResult {
  edges_created: number;
  edges_deprecated: number;
  audit_node_id: string;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function ingestFile(path: string, sourceType: string): Promise<IngestionJob> {
  return invoke('ingest_file', { path, sourceType });
}

export async function getIngestionStatus(): Promise<IngestionJob[]> {
  return invoke('get_ingestion_status');
}

export async function askQuestion(question: string): Promise<BackendQueryResult> {
  return invoke('ask_question', { question });
}

export async function getGraphSnapshot(): Promise<GraphSnapshot> {
  return invoke('get_graph_snapshot');
}

export async function submitCorrection(rawText: string, author: string): Promise<CorrectionEntry> {
  return invoke('submit_correction', { rawText, author });
}

export async function confirmCorrection(correctionId: string): Promise<CorrectionResult> {
  return invoke('confirm_correction', { correctionId });
}

export async function listCorrections(): Promise<CorrectionEntry[]> {
  return invoke('list_corrections');
}

// ─── File Dialog ──────────────────────────────────────────────────────────────

export async function pickFiles(): Promise<string[]> {
  const result = await openDialog({
    multiple: true,
    filters: [
      { name: 'Supported files', extensions: ['pdf', 'csv', 'xlsx', 'eml', 'txt'] },
    ],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sourceTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'csv':
    case 'xlsx':
    case 'xls': return 'erp';
    case 'eml':
    case 'msg': return 'email';
    default: return 'pdf';
  }
}
