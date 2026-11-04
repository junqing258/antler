import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import {
  Dialog as Drawer,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger as DrawerTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function DrawerContent({
  children,
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPortal>
      <DialogOverlay className="transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex">
        <DialogPrimitive.Popup
          className={cn(
            "relative flex h-full w-[min(300px,calc(100vw-48px))] flex-col bg-[#fbfbfb] px-3 pb-[max(14px,env(safe-area-inset-bottom))] pl-[5px] pt-[max(8px,env(safe-area-inset-top))] shadow-xl outline-none transition-transform duration-200 data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          <DialogTitle className="sr-only">会话导航</DialogTitle>
          <DialogClose
            className="absolute right-2 top-[max(16px,env(safe-area-inset-top))] z-10 grid size-10 place-items-center rounded-lg text-[#777] hover:bg-[#eaeaea] focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="关闭导航"
          >
            <XIcon className="size-5" aria-hidden="true" />
          </DialogClose>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  );
}

export { Drawer, DrawerContent, DrawerTrigger };
