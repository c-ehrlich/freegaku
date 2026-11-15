import type * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-[13px] text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
