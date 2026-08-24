precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uTexture;

uniform float uCutoff;
uniform float uFoam;
uniform float uDepth;
uniform float uBodyAlpha;
uniform float uEdgeAlpha;

void main() {
    vec4 sample = texture2D(uTexture, vTextureCoord);
    float dens = sample.a;

    if (dens < uCutoff) discard;

    if (dens < uFoam) {
        gl_FragColor = vec4(1.0);
        return;
    }

    // Soft depth: lighter near the foam band, slightly darker in the dense core.
    float depth = smoothstep(uFoam, uFoam + max(uDepth, 0.001), dens);
    vec3 col = mix(sample.rgb * 1.12, sample.rgb * 0.72, depth);
    float a = mix(uEdgeAlpha, uBodyAlpha, depth);

    gl_FragColor = vec4(col, a);
}
