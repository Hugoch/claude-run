"use client";

import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export type ShimmerProps = ComponentProps<"span"> & {
  duration?: number;
};

export const Shimmer = ({
  className,
  duration = 2,
  children,
  ...props
}: ShimmerProps) => (
  <span
    className={cn(
      "inline-block bg-gradient-to-r from-current via-muted-foreground/40 to-current bg-clip-text text-transparent bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]",
      className,
    )}
    style={{ animationDuration: `${duration}s` }}
    {...props}
  >
    {children}
  </span>
);
