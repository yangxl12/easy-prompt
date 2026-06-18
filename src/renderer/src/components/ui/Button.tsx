import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:hover:opacity-40',
  secondary:
    'bg-bg-subtle text-text border border-border hover:bg-bg-surface disabled:opacity-40',
  ghost: 'text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-40',
  danger: 'bg-red-600 text-white hover:opacity-90 disabled:opacity-40'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-9 px-3.5 text-sm rounded-md'
}

/** Minimal styled button. Intentionally tiny — no UI lib dependency. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  )
})
