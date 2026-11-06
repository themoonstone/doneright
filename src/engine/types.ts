/** Engine-facing types. Detectors only see this interface, never pdfjs. */

export interface Rect {
  /** points, origin top-left of the visible page */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextRun {
  str: string;
  rect: Rect;
  fontSize: number;
  /** rotation of the text itself, degrees clockwise */
  angle: number;
  fontName?: string;
}

export interface ImageRect {
  rect: Rect;
}

export interface DrawingRect {
  rect: Rect;
}

export interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  runs: TextRun[];
  images: ImageRect[];
  drawings: DrawingRect[];
}

export interface OpenedDocument {
  pages: PageInfo[];
  /** engine version string reported in runtime info */
  engineVersion: string;
}

export interface OpenLimits {
  maxPages: number;
}

export interface PdfOpenError extends Error {
  code: 'E_PARSE' | 'E_ENCRYPTED' | 'E_ZERO_PAGES' | 'E_LIMIT';
  detail?: string;
}
