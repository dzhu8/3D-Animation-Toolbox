import { LinearTransfer, Matrix3, SRGBTransfer } from "three";

/** @module ColorSpaces */

// Reference: http://www.russellcottrell.com/photo/matrixCalculator.htm

const P3_PRIMARIES = [0.68, 0.32, 0.265, 0.69, 0.15, 0.06];
const P3_LUMINANCE_COEFFICIENTS = [0.2289, 0.6917, 0.0793];
const REC2020_PRIMARIES = [0.708, 0.292, 0.17, 0.797, 0.131, 0.046];
const REC2020_LUMINANCE_COEFFICIENTS = [0.2627, 0.678, 0.0593];
const D65 = [0.3127, 0.329];

/** Display P3 definitions */

const LINEAR_DISPLAY_P3_TO_XYZ = /*@__PURE__*/ new Matrix3().set(
     0.4865709,
     0.2656677,
     0.1982173,
     0.2289746,
     0.6917385,
     0.0792869,
     0.0,
     0.0451134,
     1.0439444
);

const XYZ_TO_LINEAR_DISPLAY_P3 = /*@__PURE__*/ new Matrix3().set(
     2.4934969,
     -0.9313836,
     -0.4027108,
     -0.829489,
     1.7626641,
     0.0236247,
     0.0358458,
     -0.0761724,
     0.9568845
);

/**
 * Display-P3 color space.
 *
 * @constant
 * @type {string}
 */
export const DisplayP3ColorSpace = "display-p3";

/**
 * Display-P3-Linear color space.
 *
 * @constant
 * @type {string}
 */
export const LinearDisplayP3ColorSpace = "display-p3-linear";

/**
 * Implementation object for the Display-P3 color space.
 *
 * @constant
 * @type {module:ColorSpaces~ColorSpaceImpl}
 */
export const DisplayP3ColorSpaceImpl = {
     primaries: P3_PRIMARIES,
     whitePoint: D65,
     transfer: SRGBTransfer,
     toXYZ: LINEAR_DISPLAY_P3_TO_XYZ,
     fromXYZ: XYZ_TO_LINEAR_DISPLAY_P3,
     luminanceCoefficients: P3_LUMINANCE_COEFFICIENTS,
     outputColorSpaceConfig: { drawingBufferColorSpace: DisplayP3ColorSpace },
};

/**
 * Implementation object for the Display-P3-Linear color space.
 *
 * @constant
 * @type {module:ColorSpaces~ColorSpaceImpl}
 */
export const LinearDisplayP3ColorSpaceImpl = {
     primaries: P3_PRIMARIES,
     whitePoint: D65,
     transfer: LinearTransfer,
     toXYZ: LINEAR_DISPLAY_P3_TO_XYZ,
     fromXYZ: XYZ_TO_LINEAR_DISPLAY_P3,
     luminanceCoefficients: P3_LUMINANCE_COEFFICIENTS,
     workingColorSpaceConfig: { unpackColorSpace: DisplayP3ColorSpace },
     outputColorSpaceConfig: { drawingBufferColorSpace: DisplayP3ColorSpace },
};

/** Rec. 2020 definitions */

const LINEAR_REC2020_TO_XYZ = /*@__PURE__*/ new Matrix3().set(
     0.636958,
     0.1446169,
     0.168881,
     0.2627002,
     0.6779981,
     0.0593017,
     0.0,
     0.0280727,
     1.0609851
);

const XYZ_TO_LINEAR_REC2020 = /*@__PURE__*/ new Matrix3().set(
     1.7166512,
     -0.3556708,
     -0.2533663,
     -0.6666844,
     1.6164812,
     0.0157685,
     0.0176399,
     -0.0427706,
     0.9421031
);

/**
 * Rec2020-Linear color space.
 *
 * @constant
 * @type {string}
 */
export const LinearRec2020ColorSpace = "rec2020-linear";

/**
 * Implementation object for the Rec2020-Linear color space.
 *
 * @constant
 * @type {module:ColorSpaces~ColorSpaceImpl}
 */
export const LinearRec2020ColorSpaceImpl = {
     primaries: REC2020_PRIMARIES,
     whitePoint: D65,
     transfer: LinearTransfer,
     toXYZ: LINEAR_REC2020_TO_XYZ,
     fromXYZ: XYZ_TO_LINEAR_REC2020,
     luminanceCoefficients: REC2020_LUMINANCE_COEFFICIENTS,
};

/**
 * An object holding the color space implementation.
 *
 * @typedef {Object} module:ColorSpaces~ColorSpaceImpl
 * @property {number[]} primaries - The primaries.
 * @property {number[]} whitePoint - The white point.
 * @property {Matrix3} toXYZ - A color space conversion matrix, converting to CIE XYZ.
 * @property {Matrix3} fromXYZ - A color space conversion matrix, converting from CIE XYZ.
 * @property {number[]} luminanceCoefficients - The luminance coefficients.
 * @property {{ unpackColorSpace: string }} [workingColorSpaceConfig] - The working color space config.
 * @property {{ drawingBufferColorSpace: string }} [outputColorSpaceConfig] - The drawing buffer color space config.
 */
