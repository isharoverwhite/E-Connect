import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
    title: 'IoT Ecosystem Central Dashboard',
    description: 'Manage your smart home devices and automation',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body className={`${inter.className} bg-background text-foreground antialiased`}>
                {children}
            </body>
        </html>
    )
}
