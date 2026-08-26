import { useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface NoteIndicatorProps {
  comment?: string | null;
  className?: string;
}

/**
 * Compact access point for a note entered on a Master override cell.
 * Opens on hover/focus for desktop and click/tap for keyboard and touch users.
 */
export function NoteIndicator({ comment, className }: NoteIndicatorProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openNote = () => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => cancelClose(), []);

  if (!comment?.trim()) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="View roster note"
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-violet-600 transition-colors hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-400 dark:hover:bg-violet-950/50",
            className,
          )}
          onClick={(event) => event.stopPropagation()}
          onFocus={openNote}
          onBlur={scheduleClose}
          onMouseEnter={openNote}
          onMouseLeave={scheduleClose}
        >
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 text-xs leading-relaxed"
        align="start"
        onMouseEnter={openNote}
        onMouseLeave={scheduleClose}
      >
        {comment}
      </PopoverContent>
    </Popover>
  );
}
