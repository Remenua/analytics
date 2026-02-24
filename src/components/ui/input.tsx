import React from 'react';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`h-9 rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200 ${className}`.trim()}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
