/* eslint-disable @next/next/no-img-element */

import type { ImgHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

const YOUTUBE_ICON_PATH = "/brands/youtube/yt_icon_red_digital.png"

type YouTubeBrandIconProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height"
> & {
  compact?: boolean
}

/**
 * Official full-color YouTube Icon downloaded from brand.youtube.
 *
 * The source PNG includes YouTube's required transparent clear space. Keep the
 * complete image visible. The default 40px canvas gives prominent placements
 * extra visual weight. The compact 38px canvas keeps the PNG's required clear
 * space while rendering its visible red mark at just over 20px high.
 */
export function YouTubeBrandIcon({
  alt = "",
  className,
  compact = false,
  style,
  ...props
}: YouTubeBrandIconProps) {
  const minWidth = compact ? 44 : 48
  const minHeight = compact ? 38 : 40

  return (
    <img
      {...props}
      src={YOUTUBE_ICON_PATH}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={minWidth}
      height={minHeight}
      draggable={false}
      className={cn("shrink-0 object-contain", className)}
      style={{
        ...style,
        minWidth,
        minHeight,
        objectFit: "contain",
        filter: "none",
        opacity: 1,
        transform: "none",
      }}
    />
  )
}
