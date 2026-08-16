'use client';

interface AlertBannerProps {
  type: 'budget' | 'idle' | 'info';
  message: string;
  onDismiss?: () => void;
}

export function AlertBanner({ type, message, onDismiss }: AlertBannerProps) {
  const colorMap = {
    budget: 'bg-red-900 border-red-500 text-red-200',
    idle: 'bg-yellow-900 border-yellow-500 text-yellow-200',
    info: 'bg-blue-900 border-blue-500 text-blue-200',
  };

  return (
    <div className={`border-l-4 p-3 rounded-r flex items-center justify-between ${colorMap[type]}`}>
      <span className="text-sm">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-4 text-current opacity-60 hover:opacity-100 text-lg leading-none">
          ×
        </button>
      )}
    </div>
  );
}
