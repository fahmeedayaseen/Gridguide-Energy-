import "./globals.css";
export const metadata = {
  title: "GridGuide — Home Energy Intelligence",
  description: "Turn your solar, battery, and EV into a revenue stream.",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
        <meta name="theme-color" content="#000B17"/>
      </head>
      <body style={{ margin:0, padding:0, background:"#000B17" }}>{children}</body>
    </html>
  );
}
