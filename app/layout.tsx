import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nutri AI Workspace",
  description: "Plataforma profissional para nutricionistas com RAG clínico",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
