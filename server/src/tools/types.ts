export interface ToolParamSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParamSchema;
  properties?: Record<string, ToolParamSchema>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolParamSchema>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
