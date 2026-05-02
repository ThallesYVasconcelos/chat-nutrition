import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prato Clínico",
  description: "Planejamento alimentar guiado por conversa clínica e evidências",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
