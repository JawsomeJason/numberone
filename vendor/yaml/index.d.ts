// Hand-written by tools/vendor.sh. Covers the part of yaml's API that numberone uses.
export type YAMLOptions = { prettyErrors?: boolean; strict?: boolean; uniqueKeys?: boolean; maxAliasCount?: number };
export declare class YAMLError extends Error {
  code: string;
  pos: [number, number];
  linePos?: [{ line: number; col: number }] | [{ line: number; col: number }, { line: number; col: number }];
}
export declare class YAMLParseError extends YAMLError {}
export declare class YAMLWarning extends YAMLError {}
export declare function parse(src: string, options?: YAMLOptions): unknown;
export declare function stringify(value: unknown): string;
export declare function parseDocument(src: string, options?: YAMLOptions): {
  errors: YAMLParseError[];
  warnings: YAMLWarning[];
  toJS(): unknown;
};
