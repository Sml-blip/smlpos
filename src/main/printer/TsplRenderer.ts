import type { LabelTemplateData } from './LabelTemplate';

export interface PrinterLanguageRenderer {
  render(
    template: LabelTemplateData,
    data: { nom: string; code: string; prix: string },
    copies: number
  ): string;
}

export class TsplRenderer implements PrinterLanguageRenderer {
  render(
    template: LabelTemplateData,
    data: { nom: string; code: string; prix: string },
    copies: number
  ): string {
    const direction = template.rotationDeg === 180 ? 'DIRECTION 1,0' : 'DIRECTION 0,0';
    const lines: string[] = [
      `SIZE ${template.widthMm} mm,${template.heightMm} mm`,
      'GAP 3 mm,0 mm',
      direction,
      'OFFSET 0 mm',
      'SPEED 2',
      'DENSITY 12',
      'SET PEEL OFF',
      'SET CUTTER OFF',
      'CODEPAGE UTF-8',
      'CLS',
    ];

    if (template.name.visible) {
      // Clean special characters and slice designation if extremely long to avoid command corruption
      const cleanNom = data.nom.replace(/"/g, '\\"');
      const nom = cleanNom.length > 32 ? `${cleanNom.slice(0, 30)}..` : cleanNom;
      lines.push(`TEXT ${template.name.x},${template.name.y},"2",0,1,1,"${nom}"`);
    }

    if (template.barcode.visible) {
      const cleanCode = data.code.replace(/"/g, '');
      const readable = template.showBarcodeText ? 2 : 0;
      // TSPL BARCODE x,y,"code_type",height,human_readable,rotation,narrow,wide,"content"
      // Narrow bar is 2 dots, wide bar is 4 dots
      lines.push(
        `BARCODE ${template.barcode.x},${template.barcode.y},"128",${template.barcode.h},${readable},0,2,4,"${cleanCode}"`
      );
    }

    if (template.price.visible) {
      const cleanPrix = data.prix.replace(/"/g, '');
      lines.push(`TEXT ${template.price.x},${template.price.y},"2",0,1,2,"${cleanPrix}"`);
    }

    lines.push(`PRINT ${Math.max(1, copies)},1`);
    return lines.join('\r\n');
  }
}
