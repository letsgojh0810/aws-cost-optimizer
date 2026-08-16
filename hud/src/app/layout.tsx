import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AWS Cost Optimizer HUD',
  description: 'Monitor and optimize your AWS costs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-900 text-white min-h-screen antialiased">
        <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">AWS Cost Optimizer</span>
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">HUD</span>
          </div>
        </header>
        <main className="px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
