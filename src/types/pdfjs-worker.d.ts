// pdfjs-dist ships no typings for its worker entry point. The Milanote PDF reader
// imports it statically so serverless bundlers (Vercel's file tracer) include the
// file, then hands its message handler to pdf.js instead of letting pdf.js
// dynamic-import a path that was never packaged.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
