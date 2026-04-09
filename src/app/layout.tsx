import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import "./globals.css";

const fontVariables = {
  "--font-geist-sans": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--font-geist-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
} as CSSProperties;

export const metadata: Metadata = {
  title: "MyBMAD Dashboard",
  description: "Visualize BMAD projects from GitHub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={fontVariables} className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
