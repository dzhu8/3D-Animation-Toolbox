import { TempNode } from "three/webgpu";
import { rand, Fn, fract, time, uv, clamp, mix, vec4, nodeProxy } from "three/tsl";

/**
 * Post processing node for creating a film grain effect.
 *
 * @augments TempNode
 * @three_import import { film } from 'three/addons/tsl/display/FilmNode.js';
 */
class FilmNode extends TempNode {
     static get type() {
          return "FilmNode";
     }

     /**
      * Constructs a new film node.
      *
      * @param {Node} inputNode - The node that represents the input of the effect.
      * @param {?Node<float>} [intensityNode=null] - A node that represents the effect's intensity. Default is `null`
      * @param {?Node<vec2>} [uvNode=null] - A node that allows to pass custom (e.g. animated) uv data. Default is
      *   `null`
      */
     constructor(inputNode, intensityNode = null, uvNode = null) {
          super("vec4");

          /**
           * The node that represents the input of the effect.
           *
           * @type {Node}
           */
          this.inputNode = inputNode;

          /**
           * A node that represents the effect's intensity.
           *
           * @default null
           * @type {?Node<float>}
           */
          this.intensityNode = intensityNode;

          /**
           * A node that allows to pass custom (e.g. animated) uv data.
           *
           * @default null
           * @type {?Node<vec2>}
           */
          this.uvNode = uvNode;
     }

     /**
      * This method is used to setup the effect's TSL code.
      *
      * @param {NodeBuilder} builder - The current node builder.
      * @returns {ShaderCallNodeInternal}
      */
     setup(/* builder */) {
          const uvNode = this.uvNode || uv();

          const film = Fn(() => {
               const base = this.inputNode.rgb;
               const noise = rand(fract(uvNode.add(time)));

               let color = base.add(base.mul(clamp(noise.add(0.1), 0, 1)));

               if (this.intensityNode !== null) {
                    color = mix(base, color, this.intensityNode);
               }

               return vec4(color, this.inputNode.a);
          });

          const outputNode = film();

          return outputNode;
     }
}

export default FilmNode;

/**
 * TSL function for creating a film node for post processing.
 *
 * @function
 * @param {Node<vec4>} inputNode - The node that represents the input of the effect.
 * @param {?Node<float>} [intensityNode=null] - A node that represents the effect's intensity. Default is `null`
 * @param {?Node<vec2>} [uvNode=null] - A node that allows to pass custom (e.g. animated) uv data. Default is `null`
 * @returns {FilmNode}
 * @tsl
 */
export const film = /*@__PURE__*/ nodeProxy(FilmNode);
