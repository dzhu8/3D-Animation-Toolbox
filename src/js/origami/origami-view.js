import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// Use global THREE object instead of imports
let scene, camera, renderer, controls;
let crane = null;
let currentMaterial = null;

// Material definitions
const materials = {
    paper: {
        name: 'Paper (White)',
        create: () => new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            side: THREE.DoubleSide
        })
    },
    toonPaper: {
        name: 'Toon Paper (White)',
        create: () => new THREE.MeshToonMaterial({ 
            color: 0xffffff,
            side: THREE.DoubleSide
        })
    }
};

function initOrigamiViewer() {
    const container = document.getElementById('container');
    const loadingDiv = document.getElementById('loading');

    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    // Create camera
    camera = new THREE.PerspectiveCamera(
        75, 
        window.innerWidth / window.innerHeight, 
        0.1, 
        1000
    );
    camera.position.set(5, 5, 5);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xffffff, 1);
    container.appendChild(renderer.domElement);

    // Add orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI / 1.5;

    // Add lighting
    setupLighting();

    // Load the crane model
    loadCraneModel();

    // Setup material selector
    setupMaterialSelector();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start the animation loop
    animate();
}

function setupLighting() {
    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xf8f8ff, 0.6);
    scene.add(ambientLight);

    // Main directional light (sun-like)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);

    // Fill light from the opposite side
    const fillLight = new THREE.DirectionalLight(0xf8f8ff, 0.3);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    // Point light for additional highlights
    const pointLight = new THREE.PointLight(0xffffff, 0.5, 100);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);
}

function setupMaterialSelector() {
    const dropdown = document.getElementById('material-dropdown');
    dropdown.addEventListener('change', function(event) {
        const selectedMaterial = event.target.value;
        changeMaterial(selectedMaterial);
    });
}

function changeMaterial(materialType) {
    if (!crane || !materials[materialType]) {
        console.warn('Crane not loaded or invalid material type:', materialType);
        return;
    }

    // Remove any existing edge wireframes
    const edgeObjects = [];
    crane.traverse(function(child) {
        if (child.userData.isEdgeWireframe) {
            edgeObjects.push(child);
        }
    });
    edgeObjects.forEach(edge => crane.remove(edge));

    // Dispose of the current material if it exists
    if (currentMaterial) {
        currentMaterial.dispose();
    }

    // Create the new material
    currentMaterial = materials[materialType].create();
    
    // Apply the new material to all meshes in the crane
    crane.traverse(function (child) {
        if (child.isMesh) {
            child.material = currentMaterial;
            child.castShadow = true;
            child.receiveShadow = true;

            // Add black wireframe edges for both material types
            const edges = new THREE.EdgesGeometry(child.geometry);
            const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
            const wireframe = new THREE.LineSegments(edges, lineMaterial);
            
            // Mark this as an edge wireframe for cleanup
            wireframe.userData.isEdgeWireframe = true;
            
            // Position the wireframe exactly on the mesh
            wireframe.position.copy(child.position);
            wireframe.rotation.copy(child.rotation);
            wireframe.scale.copy(child.scale);
            
            crane.add(wireframe);
        }
    });

    console.log(`Material changed to: ${materials[materialType].name}`);
}

function loadCraneModel() {
    const loadingDiv = document.getElementById('loading');
    const loader = new OBJLoader();
    
    loader.load(
        'assets/crane-3D.obj',
        function (object) {
            // Model loaded successfully
            crane = object;
            
            // Apply default material (paper)
            changeMaterial('paper');

            // Center and scale the model
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 3 / maxDim; // Scale to fit in a 3 unit box

            object.scale.setScalar(scale);
            object.position.sub(center.multiplyScalar(scale));

            scene.add(object);
            loadingDiv.classList.add('hidden');
            
            console.log('3D Origami Crane loaded successfully!');
        },
        function (progress) {
            console.log('Loading progress:', progress);
        },
        function (error) {
            console.error('Error loading crane model:', error);
            loadingDiv.innerHTML = 'Error loading 3D model. Please check the console for details.';
        }
    );
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    // Update controls
    controls.update();

    // Optional: Add a gentle auto-rotation when not interacting
    if (crane && !controls.autoRotate) {
        // crane.rotation.y += 0.005;
    }

    // Render the scene
    renderer.render(scene, camera);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initOrigamiViewer);
