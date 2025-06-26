import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

// Global variables
let container, stats;
let camera, scene, renderer;
let mouseX = 0, mouseY = 0;

const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;

// Simulation parameters
let hash = document.location.hash.substr(1);
if (hash) hash = parseInt(hash, 0);

const WIDTH = hash || 32;
const BIRDS = WIDTH * WIDTH;
const BOUNDS = 800;
const BOUNDS_HALF = BOUNDS / 2;

// GPU Compute variables
let gpuCompute;
let velocityVariable;
let positionVariable;
let positionUniforms;
let velocityUniforms;
let birdUniforms;
let birdMesh;

let last = performance.now();

// Custom Bird Geometry
class BirdGeometry extends THREE.BufferGeometry {
    constructor() {
        super();

        const triangles = BIRDS * 3;
        const points = triangles * 3;

        const vertices = new Float32Array(points * 3);
        const birdColors = new Float32Array(points * 3);
        const references = new Float32Array(points * 2);
        const birdVertex = new Float32Array(points);

        this.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        this.setAttribute('birdColor', new THREE.BufferAttribute(birdColors, 3));
        this.setAttribute('reference', new THREE.BufferAttribute(references, 2));
        this.setAttribute('birdVertex', new THREE.BufferAttribute(birdVertex, 1));

        let v = 0;

        function verts_push() {
            for (let i = 0; i < arguments.length; i++) {
                vertices[v++] = arguments[i];
            }
        }

        const wingsSpan = 20;

        for (let f = 0; f < BIRDS; f++) {
            // Body
            verts_push(
                0, -0, -20,
                0, 4, -20,
                0, 0, 30
            );

            // Left Wing
            verts_push(
                0, 0, -15,
                -wingsSpan, 0, 0,
                0, 0, 15
            );

            // Right Wing
            verts_push(
                0, 0, 15,
                wingsSpan, 0, 0,
                0, 0, -15
            );
        }

        for (let v = 0; v < triangles * 3; v++) {
            const i = ~~(v / 3);
            const x = (i % WIDTH) / WIDTH;
            const y = ~~(i / WIDTH) / WIDTH;

            const c = new THREE.Color(
                0x444444 +
                ~~(v / 9) / BIRDS * 0x666666
            );

            birdColors[v * 3 + 0] = c.r;
            birdColors[v * 3 + 1] = c.g;
            birdColors[v * 3 + 2] = c.b;

            references[v * 2] = x;
            references[v * 2 + 1] = y;

            birdVertex[v] = v % 9;
        }

        this.scale(0.2, 0.2, 0.2);
    }
}

// Initialize
init();
animate();

function init() {
    container = document.getElementById('ThreeJS');

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 3000);
    camera.position.z = 350;

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 100, 1000);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(scene.fog.color);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Initialize GPU Compute
    initComputeRenderer();

    // Stats
    stats = new Stats();
    stats.domElement.style.position = 'absolute';
    stats.domElement.style.bottom = '0px';
    stats.domElement.style.zIndex = 100;
    container.appendChild(stats.domElement);

    // Event listeners
    document.addEventListener('mousemove', onDocumentMouseMove, false);
    document.addEventListener('touchstart', onDocumentTouchStart, false);
    document.addEventListener('touchmove', onDocumentTouchMove, false);
    window.addEventListener('resize', onWindowResize, false);

    // GUI
    const gui = new GUI();

    const effectController = {
        seperation: 20.0,
        alignment: 20.0,
        cohesion: 20.0,
        freedom: 0.75
    };

    const valuesChanger = function() {
        velocityUniforms.seperationDistance.value = effectController.seperation;
        velocityUniforms.alignmentDistance.value = effectController.alignment;
        velocityUniforms.cohesionDistance.value = effectController.cohesion;
        velocityUniforms.freedomFactor.value = effectController.freedom;
    };

    valuesChanger();

    gui.add(effectController, "seperation", 0.0, 100.0, 1.0).onChange(valuesChanger);
    gui.add(effectController, "alignment", 0.0, 100, 0.001).onChange(valuesChanger);
    gui.add(effectController, "cohesion", 0.0, 100, 0.025).onChange(valuesChanger);
    gui.close();

    // Initialize birds
    initBirds();

    // Update UI
    document.getElementById('birds').innerText = BIRDS;
    
    // Create options
    let options = '';
    for (let i = 1; i < 7; i++) {
        const j = Math.pow(2, i);
        options += `<a href="#" onclick="return change(${j})">${j * j}</a> `;
    }
    document.getElementById('options').innerHTML = options;

    // Make change function available globally
    window.change = function(n) {
        location.hash = n;
        location.reload();
        return false;
    };
}

function initComputeRenderer() {
    gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    fillPositionTexture(dtPosition);
    fillVelocityTexture(dtVelocity);

    velocityVariable = gpuCompute.addVariable(
        "textureVelocity", 
        document.getElementById('fragmentShaderVelocity').textContent, 
        dtVelocity
    );
    positionVariable = gpuCompute.addVariable(
        "texturePosition", 
        document.getElementById('fragmentShaderPosition').textContent, 
        dtPosition
    );

    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

    positionUniforms = positionVariable.material.uniforms;
    velocityUniforms = velocityVariable.material.uniforms;

    positionUniforms.time = { value: 0.0 };
    positionUniforms.delta = { value: 0.0 };
    velocityUniforms.time = { value: 1.0 };
    velocityUniforms.delta = { value: 0.0 };
    velocityUniforms.testing = { value: 1.0 };
    velocityUniforms.seperationDistance = { value: 1.0 };
    velocityUniforms.alignmentDistance = { value: 1.0 };
    velocityUniforms.cohesionDistance = { value: 1.0 };
    velocityUniforms.freedomFactor = { value: 1.0 };
    velocityUniforms.predator = { value: new THREE.Vector3() };
    velocityVariable.material.defines.BOUNDS = BOUNDS.toFixed(2);

    velocityVariable.wrapS = THREE.RepeatWrapping;
    velocityVariable.wrapT = THREE.RepeatWrapping;
    positionVariable.wrapS = THREE.RepeatWrapping;
    positionVariable.wrapT = THREE.RepeatWrapping;

    const error = gpuCompute.init();
    if (error !== null) {
        console.error(error);
    }
}

function initBirds() {
    const geometry = new BirdGeometry();

    // Uniforms for bird shader
    birdUniforms = {
        color: { value: new THREE.Color(0xff2200) },
        texturePosition: { value: null },
        textureVelocity: { value: null },
        time: { value: 1.0 },
        delta: { value: 0.0 }
    };

    // Shader Material
    const material = new THREE.ShaderMaterial({
        uniforms: birdUniforms,
        vertexShader: document.getElementById('birdVS').textContent,
        fragmentShader: document.getElementById('birdFS').textContent,
        side: THREE.DoubleSide
    });

    birdMesh = new THREE.Mesh(geometry, material);
    birdMesh.rotation.y = Math.PI / 2;
    birdMesh.matrixAutoUpdate = false;
    birdMesh.updateMatrix();

    scene.add(birdMesh);
}

function fillPositionTexture(texture) {
    const theArray = texture.image.data;

    for (let k = 0, kl = theArray.length; k < kl; k += 4) {
        const x = Math.random() * BOUNDS - BOUNDS_HALF;
        const y = Math.random() * BOUNDS - BOUNDS_HALF;
        const z = Math.random() * BOUNDS - BOUNDS_HALF;

        theArray[k + 0] = x;
        theArray[k + 1] = y;
        theArray[k + 2] = z;
        theArray[k + 3] = 1;
    }
}

function fillVelocityTexture(texture) {
    const theArray = texture.image.data;

    for (let k = 0, kl = theArray.length; k < kl; k += 4) {
        const x = Math.random() - 0.5;
        const y = Math.random() - 0.5;
        const z = Math.random() - 0.5;

        theArray[k + 0] = x * 10;
        theArray[k + 1] = y * 10;
        theArray[k + 2] = z * 10;
        theArray[k + 3] = 1;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onDocumentMouseMove(event) {
    mouseX = event.clientX - windowHalfX;
    mouseY = event.clientY - windowHalfY;
}

function onDocumentTouchStart(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        mouseX = event.touches[0].pageX - windowHalfX;
        mouseY = event.touches[0].pageY - windowHalfY;
    }
}

function onDocumentTouchMove(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        mouseX = event.touches[0].pageX - windowHalfX;
        mouseY = event.touches[0].pageY - windowHalfY;
    }
}

function animate() {
    requestAnimationFrame(animate);
    render();
    stats.update();
}

function render() {
    const now = performance.now();
    let delta = (now - last) / 1000;

    if (delta > 1) delta = 1; // safety cap on large deltas
    last = now;

    positionUniforms.time.value = now;
    positionUniforms.delta.value = delta;
    velocityUniforms.time.value = now;
    velocityUniforms.delta.value = delta;
    birdUniforms.time.value = now;
    birdUniforms.delta.value = delta;

    velocityUniforms.predator.value.set(0.5 * mouseX / windowHalfX, -0.5 * mouseY / windowHalfY, 0);

    mouseX = 10000;
    mouseY = 10000;

    gpuCompute.compute();

    birdUniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
    birdUniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;

    renderer.render(scene, camera);
}