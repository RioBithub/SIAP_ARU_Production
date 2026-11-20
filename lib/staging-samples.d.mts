export interface SampleCase {
  number: number;
  title: string;
  sender?: string;
  reference?: string;
  original: string;
  receipt?: string;
  confidentiality?: string;
  summary?: string;
  invoice?: boolean;
}
export interface SampleDoc {
  id: string;
  scenario: number;
  title: string;
  filename: string;
  paragraphs: string[];
}
export const sampleCases: SampleCase[];
export const sampleDocs: SampleDoc[];
export function demoDate(days?: number): string;
export function samplePdf(id: string, date?: string): Promise<Uint8Array | null>;
