export interface LabelItemGeometry {
  x: number; // in dots
  y: number; // in dots
  w: number; // in dots
  h: number; // in dots
  visible: boolean;
}

export interface LabelTemplateData {
  widthMm: number;
  heightMm: number;
  widthDots: number;
  heightDots: number;
  rotationDeg: 0 | 180;
  showBarcodeText: boolean;
  name: LabelItemGeometry;
  barcode: LabelItemGeometry;
  price: LabelItemGeometry;
}

export const DPI = 203;
export const MM_PER_INCH = 25.4;

export function mmToDots(mm: number): number {
  return Math.round(mm * (DPI / MM_PER_INCH));
}

export function configToTemplate(cfg: {
  widthMm: number;
  heightMm: number;
  rotationDeg: 0 | 180;
  layout: {
    name: { x: number; y: number; w: number; h: number; visible: boolean };
    barcode: { x: number; y: number; w: number; h: number; visible: boolean };
    price: { x: number; y: number; w: number; h: number; visible: boolean };
    showBarcodeText: boolean;
  };
}): LabelTemplateData {
  return {
    widthMm: cfg.widthMm,
    heightMm: cfg.heightMm,
    widthDots: mmToDots(cfg.widthMm),
    heightDots: mmToDots(cfg.heightMm),
    rotationDeg: cfg.rotationDeg,
    showBarcodeText: cfg.layout.showBarcodeText,
    name: {
      x: mmToDots(cfg.layout.name.x),
      y: mmToDots(cfg.layout.name.y),
      w: mmToDots(cfg.layout.name.w),
      h: mmToDots(cfg.layout.name.h),
      visible: cfg.layout.name.visible,
    },
    barcode: {
      x: mmToDots(cfg.layout.barcode.x),
      y: mmToDots(cfg.layout.barcode.y),
      w: mmToDots(cfg.layout.barcode.w),
      h: mmToDots(cfg.layout.barcode.h),
      visible: cfg.layout.barcode.visible,
    },
    price: {
      x: mmToDots(cfg.layout.price.x),
      y: mmToDots(cfg.layout.price.y),
      w: mmToDots(cfg.layout.price.w),
      h: mmToDots(cfg.layout.price.h),
      visible: cfg.layout.price.visible,
    },
  };
}
