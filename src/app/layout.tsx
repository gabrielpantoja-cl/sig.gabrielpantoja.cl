import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SIG de suelo — Transacciones CBR | gabrielpantoja.cl",
  description:
    "Mapa interactivo y datos abiertos de compraventas de suelo rural inscritas en el Conservador de Bienes Raíces del centro-sur de Chile. Consulta por comuna, año, monto, superficie y ROL; descarga CSV/GeoJSON.",
  metadataBase: new URL("https://sig.gabrielpantoja.cl"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
