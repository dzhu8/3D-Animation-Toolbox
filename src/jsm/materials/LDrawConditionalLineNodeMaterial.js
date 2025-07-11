import { Color } from "three";
import {
     attribute,
     cameraProjectionMatrix,
     dot,
     float,
     Fn,
     modelViewMatrix,
     modelViewProjection,
     NodeMaterial,
     normalize,
     positionGeometry,
     sign,
     uniform,
     varyingProperty,
     vec2,
     vec4,
} from "three/tsl";

/**
 * A special line material for meshes loaded via {@link LDrawLoader}.
 *
 * This module can only be used with {@link WebGPURenderer}. When using {@link WebGLRenderer}, import the class from
 * `LDrawConditionalLineMaterial.js`.
 *
 * @augments NodeMaterial
 * @three_import import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
 */
class LDrawConditionalLineMaterial extends NodeMaterial {
     static get type() {
          return "LDrawConditionalLineMaterial";
     }

     /**
      * Constructs a new conditional line material.
      *
      * @param {Object} [parameters] - An object with one or more properties defining the material's appearance. Any
      *   property of the material (including any property from inherited materials) can be passed in here. Color values
      *   can be passed any type of value accepted by {@link Color#set}.
      */
     constructor(parameters) {
          super();

          const vertexNode = /*@__PURE__*/ Fn(() => {
               const control0 = attribute("control0", "vec3");
               const control1 = attribute("control1", "vec3");
               const direction = attribute("direction", "vec3");

               const mvp = cameraProjectionMatrix.mul(modelViewMatrix);

               // Transform the line segment ends and control points into camera clip space

               const c0 = mvp.mul(vec4(control0, 1)).toVar();
               const c1 = mvp.mul(vec4(control1, 1)).toVar();
               const p0 = mvp.mul(vec4(positionGeometry, 1)).toVar();
               const p1 = mvp.mul(vec4(positionGeometry.add(direction), 1)).toVar();

               c0.xy.divAssign(c0.w);
               c1.xy.divAssign(c1.w);
               p0.xy.divAssign(p0.w);
               p1.xy.divAssign(p1.w);

               // Get the direction of the segment and an orthogonal vector

               const dir = p1.xy.sub(p0.xy).toVar();
               const norm = vec2(dir.y.negate(), dir.x).toVar();

               // Get control point directions from the line
               const c0dir = c0.xy.sub(p1.xy).toVar();
               const c1dir = c1.xy.sub(p1.xy).toVar();

               // If the vectors to the controls points are pointed in different directions away
               // from the line segment then the line should not be drawn.
               const d0 = dot(normalize(norm), normalize(c0dir)).toVar();
               const d1 = dot(normalize(norm), normalize(c1dir)).toVar();
               const discardFlag = sign(d0).notEqual(sign(d1)).select(float(1), float(0));

               varyingProperty("float", "discardFlag").assign(discardFlag);

               return modelViewProjection;
          })();

          const fragmentNode = /*@__PURE__*/ Fn(() => {
               const discardFlag = varyingProperty("float", "discardFlag");

               discardFlag.greaterThan(float(0.5)).discard();

               return vec4(this._diffuseUniform, this._opacityUniform);
          })();

          this.vertexNode = vertexNode;
          this.fragmentNode = fragmentNode;

          this._diffuseUniform = uniform(new Color());
          this._opacityUniform = uniform(1);

          //

          Object.defineProperties(this, {
               /**
                * The material's opacity.
                *
                * @default 1
                * @type {number}
                * @name LDrawConditionalLineMaterial#opacity
                */
               opacity: {
                    get: function () {
                         return this._opacityUniform.value;
                    },

                    set: function (value) {
                         this._opacityUniform.value = value;
                    },
               },

               /**
                * The material's color.
                *
                * @default (1,1,1)
                * @type {Color}
                * @name LDrawConditionalLineMaterial#color
                */
               color: {
                    get: function () {
                         return this._diffuseUniform.value;
                    },

                    set: function (value) {
                         this._diffuseUniform.value.copy(value);
                    },
               },
          });

          this.setValues(parameters);

          /**
           * This flag can be used for type testing.
           *
           * @default true
           * @type {boolean}
           * @readonly
           */
          this.isLDrawConditionalLineMaterial = true;
     }
}

export { LDrawConditionalLineMaterial };
