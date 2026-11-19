declare module 'mammoth/mammoth.browser' {
  type ExtractResult = { value: string };
  const mammoth: {
    extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<ExtractResult>;
  };
  export default mammoth;
}
