"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { LazyMotion, useReducedMotion } from "motion/react"
import * as m from "motion/react-m"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

// Keep the existing shadcn CVA + Radix Slot API, using Tailwind 3 utilities.
const buttonVariants = cva(
  "inline-flex max-w-full items-center justify-center gap-3 whitespace-normal rounded-md border px-6 py-3 text-center text-sm font-medium leading-5 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:h-4 [&_svg]:w-4",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:border-[var(--ink-soft)] hover:bg-[var(--ink-soft)]",
        outline: "border-input bg-transparent text-foreground hover:border-primary hover:bg-secondary",
        secondary: "border-secondary bg-secondary text-secondary-foreground hover:border-input",
        ghost: "border-transparent bg-transparent text-foreground hover:bg-muted",
        destructive: "border-destructive bg-destructive text-primary-foreground hover:opacity-90",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
        inverted: "border-primary-foreground bg-primary-foreground text-primary hover:border-secondary hover:bg-secondary",
      },
      size: {
        default: "min-h-12",
        xs: "min-h-11 gap-1 px-3 py-2 text-xs",
        sm: "min-h-11 gap-2 px-4 py-2",
        lg: "min-h-14 px-8",
        icon: "h-12 w-12 p-0",
        "icon-xs": "h-11 w-11 p-0",
        "icon-sm": "h-11 w-11 p-0",
        "icon-lg": "h-14 w-14 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

const MotionSlot = m.create(Slot.Root)
const loadFeatures = () => import("./motion-features").then((module) => module.default)

type ButtonProps = React.ComponentPropsWithoutRef<typeof m.button> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className, variant = "default", size = "default", asChild = false,
    disabled, onPointerDown, onPointerUp, onPointerCancel, onPointerLeave,
    onBlur, ...props
  },
  ref,
) {
  const reduceMotion = useReducedMotion()
  const [pressed, setPressed] = React.useState(false)
  const Comp = asChild ? MotionSlot : m.button

  return (
    <LazyMotion features={loadFeatures} strict>
      <Comp
        {...props}
        ref={ref}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        initial={false}
        animate={{ scale: pressed && !disabled && reduceMotion === false ? 0.98 : 1 }}
        transition={{ duration: reduceMotion === false ? 0.12 : 0, ease: [0.23, 1, 0.32, 1] }}
        onPointerDown={(event) => {
          onPointerDown?.(event)
          if (!event.defaultPrevented && !disabled && event.button === 0 && event.isPrimary) setPressed(true)
        }}
        onPointerUp={(event) => { setPressed(false); onPointerUp?.(event) }}
        onPointerCancel={(event) => { setPressed(false); onPointerCancel?.(event) }}
        onPointerLeave={(event) => { setPressed(false); onPointerLeave?.(event) }}
        onBlur={(event) => { setPressed(false); onBlur?.(event) }}
      />
    </LazyMotion>
  )
})

export { Button, buttonVariants }
export type { ButtonProps }
