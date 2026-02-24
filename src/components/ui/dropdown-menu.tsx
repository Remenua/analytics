import React from 'react';

type Ctx = { open: boolean; setOpen: (v: boolean) => void };
const DropdownCtx = React.createContext<Ctx | null>(null);

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return <DropdownCtx.Provider value={{ open, setOpen }}><div className="relative inline-block">{children}</div></DropdownCtx.Provider>;
}

export function DropdownMenuTrigger({ asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(DropdownCtx)!;
  const props = { onClick: (e: React.MouseEvent) => { e.stopPropagation(); ctx.setOpen(!ctx.open); } };
  if (asChild) return React.cloneElement(children, props);
  return <button {...props}>{children}</button>;
}

export function DropdownMenuContent({ className = '', children }: { className?: string; align?: 'start'|'end'; children: React.ReactNode }) {
  const ctx = React.useContext(DropdownCtx)!;
  React.useEffect(() => {
    if (!ctx.open) return;
    const close = () => ctx.setOpen(false);
    window.addEventListener('click', close, { once: true });
    return () => window.removeEventListener('click', close);
  }, [ctx]);
  if (!ctx.open) return null;
  return <div className={`absolute left-0 mt-1 z-[10050] rounded-md border bg-white p-1 shadow-lg ${className}`}>{children}</div>;
}

export function DropdownMenuItem({ className = '', onClick, children }: { className?: string; onClick?: () => void; children: React.ReactNode }) {
  const ctx = React.useContext(DropdownCtx)!;
  return <button className={`w-full text-left flex items-center rounded px-2 py-1.5 text-sm hover:bg-gray-100 ${className}`} onClick={() => { onClick?.(); ctx.setOpen(false); }}>{children}</button>;
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-gray-200" />;
}
