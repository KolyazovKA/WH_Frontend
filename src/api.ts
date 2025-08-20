import axios from "axios";
const api = axios.create({ baseURL: "/api" });

export async function uploadFiles(sessionId: string, files: File[], onProgress?: (p:number)=>void) {
  const fd = new FormData();
  files.forEach(f=>fd.append("files", f));
  fd.append("sessionId", sessionId);
  const res = await api.post("/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    }
  });
  return res.data;
}

export async function sendQA(sessionId: string, question: string, contextMessages: any[]) {
  const res = await api.post("/qa", { sessionId, question, context: contextMessages });
  return res.data;
}

export async function search(sessionId:string, query:string, mode="semantic") {
  const res = await api.post("/search", { sessionId, query, mode });
  return res.data;
}
