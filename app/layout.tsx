import "./globals.css"
import Providers from "./providers"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#7C3AED" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
