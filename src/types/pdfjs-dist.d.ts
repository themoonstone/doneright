declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const version: string;
  export const OPS: Record<string, number>;
  export const Util: {
    transform(m1: number[], m2: number[]): number[];
  };
  export function getDocument(src: Record<string, unknown>): {
    promise: Promise<PdfDocumentProxy>;
    destroy(): Promise<void>;
  };
  export interface PdfDocumentProxy {
    numPages: number;
    getPage(n: number): Promise<PdfPageProxy>;
    destroy(): Promise<void>;
  }
  export interface PdfPageProxy {
    getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
    getTextContent(params?: { disableNormalization?: boolean }): Promise<{
      items: Array<{
        str?: string;
        width?: number;
        height?: number;
        transform?: number[];
        fontName?: string;
      }>;
    }>;
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  }
}
