export type Role = "user"|"assistant"|"system";
export interface Message {
  id: string;
  role: Role;
  text: string;
  meta?: any;
  timestamp: string;
}
export interface DocItem {
  id: string;
  name: string;
  status: "uploading"|"processing"|"indexed"|"error";
  url?: string;
}
