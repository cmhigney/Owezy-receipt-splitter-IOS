import { requireOptionalNativeModule } from 'expo-modules-core';

export type AppleVisionOCRResult =
  | string
  | string[]
  | {
      text?: string;
      lines?: (
        | string
        | {
            text?: string;
            confidence?: number;
            boundingBox?: {
              x?: number;
              y?: number;
              width?: number;
              height?: number;
            };
          }
      )[];
      averageConfidence?: number;
    };

export type AppleVisionOCRModule = {
  isAvailable?: () => boolean;
  recognizeText: (imageUri: string) => Promise<AppleVisionOCRResult>;
};

export default requireOptionalNativeModule<AppleVisionOCRModule>('AppleVisionOCR');
