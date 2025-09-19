import {
  AnimatePresence,
  motion,
  type MotionValue,
  type SpringOptions,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import {
  Children,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type DockItemData = {
  icon: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  className?: string;
};

export type DockProps = {
  items: DockItemData[];
  className?: string;
  distance?: number;
  panelHeight?: number;
  baseItemSize?: number;
  dockHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
};

type DockItemProps = {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  distance: number;
  baseItemSize: number;
  magnification: number;
};

function DockItem({
  children,
  className = "",
  onClick,
  mouseX,
  spring,
  distance,
  magnification,
  baseItemSize,
}: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? {
      x: 0,
      width: baseItemSize,
    };
    return val - rect.x - baseItemSize / 2;
  });

  const targetSize = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [baseItemSize, magnification, baseItemSize],
  );
  const size = useSpring(targetSize, spring);

  const extraClass = className ? ` ${className}` : "";

  return (
    <motion.div
      ref={ref}
      style={{ width: size, height: size }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={onClick}
      className={`relative grid place-items-center rounded-2xl border border-white/12 bg-[#0c111d]/95 text-white shadow-[0_10px_32px_-18px_rgba(3,5,12,0.85)] transition-colors hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c111d]/60${extraClass}`}
      tabIndex={0}
      role="button"
      aria-haspopup="true"
    >
      {Children.map(children, (child) =>
        cloneElement(child as ReactElement, { isHovered }),
      )}
    </motion.div>
  );
}

type DockLabelProps = {
  className?: string;
  children: ReactNode;
  isHovered?: MotionValue<number>;
};

function DockLabel({ children, className = "", isHovered }: DockLabelProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isHovered) {
      setIsVisible(false);
      return;
    }

    const unsubscribe = isHovered.on("change", (latest) => {
      setIsVisible(latest === 1);
    });

    return () => unsubscribe();
  }, [isHovered]);

  const extraClass = className ? ` ${className}` : "";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -12 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.18 }}
          className={`pointer-events-none absolute -top-7 left-1/2 w-max -translate-x-1/2 whitespace-pre rounded-md border border-white/15 bg-[#0c111d]/95 px-2 py-0.5 text-xs font-medium text-white shadow-[0_14px_28px_-22px_rgba(4,6,14,0.85)]${extraClass}`}
          role="tooltip"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DockIconProps = {
  className?: string;
  children: ReactNode;
};

function DockIcon({ children, className = "" }: DockIconProps) {
  const extraClass = className ? ` ${className}` : "";
  return <div className={`flex items-center justify-center text-lg${extraClass}`}>{children}</div>;
}

export default function Dock({
  items,
  className = "",
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = 70,
  distance = 200,
  panelHeight = 64,
  dockHeight = 256,
  baseItemSize = 50,
}: DockProps) {
  const mouseX = useMotionValue<number>(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(
    () => Math.max(dockHeight, magnification + magnification / 2 + 4),
    [dockHeight, magnification],
  );
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  const extraClass = className ? ` ${className}` : "";

  return (
    <motion.div
      style={{ height, scrollbarWidth: "none" }}
      className="mx-2 flex max-w-full items-end justify-center"
    >
      <motion.div
        onMouseMove={({ pageX }) => {
          isHovered.set(1);
          mouseX.set(pageX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={`flex items-end gap-4 rounded-2xl border border-white/15 bg-[#080c16]/85 px-4 pb-2 shadow-[0_18px_60px_-35px_rgba(2,4,9,0.9)] backdrop-blur-xl${extraClass}`}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, index) => (
          <DockItem
            key={index}
            onClick={item.onClick}
            className={item.className}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
          >
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  );
}
