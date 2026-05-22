import axios from "axios";

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  timeout: 30000,
});

export interface BookRequest {
  title: string;
  num_pages: number;
  words_per_page: number;
  user_id?: string;
}

export interface BookStatus {
  book_id: number;
  title: string;
  status: string;
  pages: number;
  pdf_url: string | null;
  docx_url: string | null;
  created_at: string;
}

export interface BookProgress {
  book_id: number;
  status: string;
  completed_segments: number;
}

export const generateBook = (data: BookRequest) =>
  API.post<{ book_id: number; status: string }>("/generate-book", data);
export const getBookStatus = (id: number) =>
  API.get<BookStatus>(`/book/${id}/status`);
export const getProgress = (id: number) =>
  API.get<BookProgress>(`/book/${id}/progress`);
export const listBooks = () => API.get<BookStatus[]>("/books");
export const downloadPDF = (id: number) =>
  `${API.defaults.baseURL}/book/${id}/download/pdf`;
export const downloadDOCX = (id: number) =>
  `${API.defaults.baseURL}/book/${id}/download/docx`;
