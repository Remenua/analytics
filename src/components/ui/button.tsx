import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'ghost';
};

export function Button({ className = '', variant = 'default', ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = variant === 'ghost' ? 'hover:bg-gray-100 text-gray-700' : 'bg-gray-900 text-white hover:bg-gray-800';
  return <button className={`${base} ${styles} ${className}`.trim()} {...props} />;
}
