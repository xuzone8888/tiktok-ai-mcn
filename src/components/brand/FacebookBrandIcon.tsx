import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

type FacebookBrandIconProps = SVGProps<SVGSVGElement> & {
  compact?: boolean
}

/** Facebook's blue circle and white "f" brand mark. */
export function FacebookBrandIcon({
  className,
  compact = false,
  ...props
}: FacebookBrandIconProps) {
  const size = compact ? 28 : 40

  return (
    <svg
      {...props}
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <circle cx="20" cy="20" r="20" fill="#0866FF" />
      <path
        fill="#FFFFFF"
        d="M27.7 26l.9-5.9H23v-3.8c0-1.6.8-3.2 3.3-3.2h2.6v-5s-2.3-.4-4.6-.4c-4.7 0-7.7 2.8-7.7 7.9v4.5h-5.1V26h5.1v14c1 .2 2 .2 3.1.2s2.1 0 3.1-.2V26h4.9Z"
      />
    </svg>
  )
}
