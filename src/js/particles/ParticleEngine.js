/**
 * ParticleEngine.js - Updated for modern Three.js (r160+)
 * Original author: Lee Stemkoski
 * Updated for compatibility with latest Three.js
 */

import * as THREE from 'three';

///////////////////////////////////////////////////////////////////////////////

/////////////
// SHADERS //
/////////////

const particleVertexShader = `
attribute vec3  customColor;
attribute float customOpacity;
attribute float customSize;
attribute float customAngle;
attribute float customVisible;

varying vec4  vColor;
varying float vAngle;

void main() {
    if ( customVisible > 0.5 ) // true
        vColor = vec4( customColor, customOpacity );
    else // false
        vColor = vec4(0.0, 0.0, 0.0, 0.0);
    
    vAngle = customAngle;

    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = customSize * ( 300.0 / length( mvPosition.xyz ) );
    gl_Position = projectionMatrix * mvPosition;
}
`;

const particleFragmentShader = `
uniform sampler2D uTexture;
varying vec4 vColor;
varying float vAngle;

void main() {
    gl_FragColor = vColor;
    
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 rotatedUV = vec2(
        c * (gl_PointCoord.x - 0.5) + s * (gl_PointCoord.y - 0.5) + 0.5,
        c * (gl_PointCoord.y - 0.5) - s * (gl_PointCoord.x - 0.5) + 0.5
    );
    vec4 rotatedTexture = texture2D( uTexture, rotatedUV );
    gl_FragColor = gl_FragColor * rotatedTexture;
}
`;

///////////////////////////////////////////////////////////////////////////////

/////////////////
// TWEEN CLASS //
/////////////////

class Tween {
    constructor(timeArray = [], valueArray = []) {
        this.times = timeArray;
        this.values = valueArray;
    }

    lerp(t) {
        let i = 0;
        const n = this.times.length;
        while (i < n && t > this.times[i]) {
            i++;
        }
        if (i === 0) return this.values[0];
        if (i === n) return this.values[n - 1];
        
        const p = (t - this.times[i - 1]) / (this.times[i] - this.times[i - 1]);
        
        if (this.values[0] instanceof THREE.Vector3) {
            return this.values[i - 1].clone().lerp(this.values[i], p);
        } else {
            // it's a float
            return this.values[i - 1] + p * (this.values[i] - this.values[i - 1]);
        }
    }
}

///////////////////////////////////////////////////////////////////////////////

////////////////////
// PARTICLE CLASS //
////////////////////

class Particle {
    constructor() {
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3(); // units per second
        this.acceleration = new THREE.Vector3();

        this.angle = 0;
        this.angleVelocity = 0; // degrees per second
        this.angleAcceleration = 0; // degrees per second, per second
        
        this.size = 16.0;

        this.color = new THREE.Color();
        this.opacity = 1.0;
                
        this.age = 0;
        this.alive = 0; // use float instead of boolean for shader purposes
        
        // These will be set by the ParticleEngine
        this.sizeTween = new Tween();
        this.colorTween = new Tween();
        this.opacityTween = new Tween();
    }

    update(dt) {
        this.position.add(this.velocity.clone().multiplyScalar(dt));
        this.velocity.add(this.acceleration.clone().multiplyScalar(dt));
        
        // convert from degrees to radians: 0.01745329251 = Math.PI/180
        this.angle += this.angleVelocity * 0.01745329251 * dt;
        this.angleVelocity += this.angleAcceleration * 0.01745329251 * dt;

        this.age += dt;
        
        // if the tween for a given attribute is nonempty,
        // then use it to update the attribute's value
        if (this.sizeTween.times.length > 0) {
            this.size = this.sizeTween.lerp(this.age);
        }
                    
        if (this.colorTween.times.length > 0) {
            const colorHSL = this.colorTween.lerp(this.age);
            this.color = new THREE.Color().setHSL(colorHSL.x, colorHSL.y, colorHSL.z);
        }
        
        if (this.opacityTween.times.length > 0) {
            this.opacity = this.opacityTween.lerp(this.age);
        }
    }
}

///////////////////////////////////////////////////////////////////////////////

///////////////////////////
// PARTICLE ENGINE CLASS //
///////////////////////////

const Type = Object.freeze({ "CUBE": 1, "SPHERE": 2 });

export class ParticleEngine {
    constructor() {
        /////////////////////////
        // PARTICLE PROPERTIES //
        /////////////////////////
        
        this.positionStyle = Type.CUBE;
        this.positionBase = new THREE.Vector3();
        // cube shape data
        this.positionSpread = new THREE.Vector3();
        // sphere shape data
        this.positionRadius = 0; // distance from base at which particles start
        
        this.velocityStyle = Type.CUBE;
        // cube movement data
        this.velocityBase = new THREE.Vector3();
        this.velocitySpread = new THREE.Vector3();
        // sphere movement data
        // direction vector calculated using initial position
        this.speedBase = 0;
        this.speedSpread = 0;
        
        this.accelerationBase = new THREE.Vector3();
        this.accelerationSpread = new THREE.Vector3();
        
        this.angleBase = 0;
        this.angleSpread = 0;
        this.angleVelocityBase = 0;
        this.angleVelocitySpread = 0;
        this.angleAccelerationBase = 0;
        this.angleAccelerationSpread = 0;
        
        this.sizeBase = 0.0;
        this.sizeSpread = 0.0;
        this.sizeTween = new Tween();
                
        // store colors in HSL format in a THREE.Vector3 object
        this.colorBase = new THREE.Vector3(0.0, 1.0, 0.5);
        this.colorSpread = new THREE.Vector3(0.0, 0.0, 0.0);
        this.colorTween = new Tween();
        
        this.opacityBase = 1.0;
        this.opacitySpread = 0.0;
        this.opacityTween = new Tween();

        this.blendStyle = THREE.NormalBlending;

        this.particleArray = [];
        this.particlesPerSecond = 100;
        this.particleDeathAge = 1.0;
        
        ////////////////////////
        // EMITTER PROPERTIES //
        ////////////////////////
        
        this.emitterAge = 0.0;
        this.emitterAlive = true;
        this.emitterDeathAge = 60; // time (seconds) at which to stop creating particles.
        
        // How many particles could be active at any time?
        this.particleCount = this.particlesPerSecond * Math.min(this.particleDeathAge, this.emitterDeathAge);

        //////////////
        // THREE.JS //
        //////////////
        
        this.particleGeometry = null;
        this.particleTexture = null;
        this.particleMaterial = null;
        this.particleMesh = null;
    }
    
    setValues(parameters) {
        if (parameters === undefined) return;
        
        // clear any previous tweens that might exist
        this.sizeTween = new Tween();
        this.colorTween = new Tween();
        this.opacityTween = new Tween();
        
        for (const key in parameters) {
            this[key] = parameters[key];
        }
        
        // Recreate Tween objects if they were passed as plain objects
        if (parameters.sizeTween && !(parameters.sizeTween instanceof Tween)) {
            this.sizeTween = new Tween(parameters.sizeTween.times, parameters.sizeTween.values);
        }
        if (parameters.colorTween && !(parameters.colorTween instanceof Tween)) {
            this.colorTween = new Tween(parameters.colorTween.times, parameters.colorTween.values);
        }
        if (parameters.opacityTween && !(parameters.opacityTween instanceof Tween)) {
            this.opacityTween = new Tween(parameters.opacityTween.times, parameters.opacityTween.values);
        }
        
        // calculate/set derived particle engine values
        this.particleArray = [];
        this.emitterAge = 0.0;
        this.emitterAlive = true;
        this.particleCount = this.particlesPerSecond * Math.min(this.particleDeathAge, this.emitterDeathAge);
    }
    
    // helper functions for randomization
    randomValue(base, spread) {
        return base + spread * (Math.random() - 0.5);
    }
    
    randomVector3(base, spread) {
        const rand3 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        return new THREE.Vector3().addVectors(base, new THREE.Vector3().multiplyVectors(spread, rand3));
    }

    createParticle() {
        const particle = new Particle();
        
        // Set the tweens from the engine
        particle.sizeTween = this.sizeTween;
        particle.colorTween = this.colorTween;
        particle.opacityTween = this.opacityTween;

        if (this.positionStyle === Type.CUBE) {
            particle.position = this.randomVector3(this.positionBase, this.positionSpread);
        }
        if (this.positionStyle === Type.SPHERE) {
            const z = 2 * Math.random() - 1;
            const t = 6.2832 * Math.random();
            const r = Math.sqrt(1 - z * z);
            const vec3 = new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), z);
            particle.position = new THREE.Vector3().addVectors(this.positionBase, vec3.multiplyScalar(this.positionRadius));
        }
            
        if (this.velocityStyle === Type.CUBE) {
            particle.velocity = this.randomVector3(this.velocityBase, this.velocitySpread);
        }
        if (this.velocityStyle === Type.SPHERE) {
            const direction = new THREE.Vector3().subVectors(particle.position, this.positionBase);
            const speed = this.randomValue(this.speedBase, this.speedSpread);
            particle.velocity = direction.normalize().multiplyScalar(speed);
        }
        
        particle.acceleration = this.randomVector3(this.accelerationBase, this.accelerationSpread);

        particle.angle = this.randomValue(this.angleBase, this.angleSpread);
        particle.angleVelocity = this.randomValue(this.angleVelocityBase, this.angleVelocitySpread);
        particle.angleAcceleration = this.randomValue(this.angleAccelerationBase, this.angleAccelerationSpread);

        particle.size = this.randomValue(this.sizeBase, this.sizeSpread);

        const color = this.randomVector3(this.colorBase, this.colorSpread);
        particle.color = new THREE.Color().setHSL(color.x, color.y, color.z);
        
        particle.opacity = this.randomValue(this.opacityBase, this.opacitySpread);

        particle.age = 0;
        particle.alive = 0; // particles initialize as inactive
        
        return particle;
    }

    initialize(scene) {
        // Create buffer geometry and attributes
        this.particleGeometry = new THREE.BufferGeometry();
        
        // Create attribute arrays
        const positions = new Float32Array(this.particleCount * 3);
        const customVisible = new Float32Array(this.particleCount);
        const customColor = new Float32Array(this.particleCount * 3);
        const customOpacity = new Float32Array(this.particleCount);
        const customSize = new Float32Array(this.particleCount);
        const customAngle = new Float32Array(this.particleCount);
        
        // Initialize particles and fill attribute arrays
        for (let i = 0; i < this.particleCount; i++) {
            this.particleArray[i] = this.createParticle();
            
            // Position
            positions[i * 3] = this.particleArray[i].position.x;
            positions[i * 3 + 1] = this.particleArray[i].position.y;
            positions[i * 3 + 2] = this.particleArray[i].position.z;
            
            // Custom attributes
            customVisible[i] = this.particleArray[i].alive;
            customColor[i * 3] = this.particleArray[i].color.r;
            customColor[i * 3 + 1] = this.particleArray[i].color.g;
            customColor[i * 3 + 2] = this.particleArray[i].color.b;
            customOpacity[i] = this.particleArray[i].opacity;
            customSize[i] = this.particleArray[i].size;
            customAngle[i] = this.particleArray[i].angle;
        }
        
        // Set attributes
        this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.particleGeometry.setAttribute('customVisible', new THREE.BufferAttribute(customVisible, 1));
        this.particleGeometry.setAttribute('customColor', new THREE.BufferAttribute(customColor, 3));
        this.particleGeometry.setAttribute('customOpacity', new THREE.BufferAttribute(customOpacity, 1));
        this.particleGeometry.setAttribute('customSize', new THREE.BufferAttribute(customSize, 1));
        this.particleGeometry.setAttribute('customAngle', new THREE.BufferAttribute(customAngle, 1));
        
        // Create material
        this.particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: this.particleTexture }
            },
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            blending: this.blendStyle,
            depthTest: this.blendStyle === THREE.NormalBlending,
            depthWrite: false
        });
        
        // Create points mesh
        this.particleMesh = new THREE.Points(this.particleGeometry, this.particleMaterial);
        // Note: sortParticles property has been removed in modern Three.js
        // Sorting is now handled automatically when needed
        scene.add(this.particleMesh);
    }

    update(dt) {
        const recycleIndices = [];
        
        // Get attribute references
        const positions = this.particleGeometry.attributes.position;
        const customVisible = this.particleGeometry.attributes.customVisible;
        const customColor = this.particleGeometry.attributes.customColor;
        const customOpacity = this.particleGeometry.attributes.customOpacity;
        const customSize = this.particleGeometry.attributes.customSize;
        const customAngle = this.particleGeometry.attributes.customAngle;
        
        // update particle data
        for (let i = 0; i < this.particleCount; i++) {
            if (this.particleArray[i].alive) {
                this.particleArray[i].update(dt);

                // check if particle should expire
                if (this.particleArray[i].age > this.particleDeathAge) {
                    this.particleArray[i].alive = 0.0;
                    recycleIndices.push(i);
                }
                
                // Update geometry positions
                positions.array[i * 3] = this.particleArray[i].position.x;
                positions.array[i * 3 + 1] = this.particleArray[i].position.y;
                positions.array[i * 3 + 2] = this.particleArray[i].position.z;
                
                // Update custom attributes
                customVisible.array[i] = this.particleArray[i].alive;
                customColor.array[i * 3] = this.particleArray[i].color.r;
                customColor.array[i * 3 + 1] = this.particleArray[i].color.g;
                customColor.array[i * 3 + 2] = this.particleArray[i].color.b;
                customOpacity.array[i] = this.particleArray[i].opacity;
                customSize.array[i] = this.particleArray[i].size;
                customAngle.array[i] = this.particleArray[i].angle;
            }
        }

        // Mark attributes as needing update
        positions.needsUpdate = true;
        customVisible.needsUpdate = true;
        customColor.needsUpdate = true;
        customOpacity.needsUpdate = true;
        customSize.needsUpdate = true;
        customAngle.needsUpdate = true;

        // check if particle emitter is still running
        if (!this.emitterAlive) return;

        // if no particles have died yet, then there are still particles to activate
        if (this.emitterAge < this.particleDeathAge) {
            // determine indices of particles to activate
            const startIndex = Math.round(this.particlesPerSecond * this.emitterAge);
            const endIndex = Math.round(this.particlesPerSecond * (this.emitterAge + dt));
            const clampedEndIndex = Math.min(endIndex, this.particleCount);
            
            for (let i = startIndex; i < clampedEndIndex; i++) {
                this.particleArray[i].alive = 1.0;
            }
        }

        // if any particles have died while the emitter is still running, we immediately recycle them
        for (let j = 0; j < recycleIndices.length; j++) {
            const i = recycleIndices[j];
            this.particleArray[i] = this.createParticle();
            this.particleArray[i].alive = 1.0; // activate right away
        }

        // stop emitter?
        this.emitterAge += dt;
        if (this.emitterAge > this.emitterDeathAge) {
            this.emitterAlive = false;
        }
    }

    destroy(scene) {
        if (this.particleMesh && scene) {
            scene.remove(this.particleMesh);
            
            // Dispose of geometry and material
            if (this.particleGeometry) {
                this.particleGeometry.dispose();
            }
            if (this.particleMaterial) {
                this.particleMaterial.dispose();
            }
            
            // Clear texture reference if needed
            if (this.particleTexture) {
                this.particleTexture.dispose();
            }
        }
    }
}

// Export Type enum for external use
export { Type, Tween };

///////////////////////////////////////////////////////////////////////////////