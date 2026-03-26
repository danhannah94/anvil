export interface Chunk {
  chunk_id: string;
  file_path: string;
  heading_path: string;
  heading_level: number;
  content: string;
  content_hash: string;
  last_modified: string;
  char_count: number;
  ordinal: number;
}
