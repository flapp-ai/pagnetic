import type { ReactNode } from "react";

export function ThemeEditorLink({
  className,
  href,
  children,
}: {
  className?: string;
  href: string;
  children?: ReactNode;
}) {
  return (
    <a className={className} href={href} rel="noreferrer" target="_top">
      {children}
    </a>
  );
}
