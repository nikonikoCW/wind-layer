import { Layer } from 'ol/layer';
import { fromUserExtent } from 'ol/proj';
import { getIntersection, isEmpty } from 'ol/extent';
// FIXME: 最好采用的是 CanvasLayerRenderer, 但是UMD版本未暴露
import ImageLayerRenderer from 'ol/renderer/canvas/ImageLayer';

class OlWindyRenderer extends ImageLayerRenderer {
  constructor(layer: typeof OlWindy) {
    super(layer);
  }

  prepareFrame(frameState: any) {
    const layerState = frameState.layerStatesArray[frameState.layerIndex];
    const pixelRatio = frameState.pixelRatio;
    const viewState = frameState.viewState;
    const viewResolution = viewState.resolution;

    const imageSource = this.getLayer().getSource();

    const hints = frameState.viewHints;

    let renderedExtent = frameState.extent;
    if (layerState.extent !== undefined) {
      renderedExtent = getIntersection(renderedExtent, fromUserExtent(layerState.extent, viewState.projection));
    }

    if (!hints[ViewHint.ANIMATING] && !hints[ViewHint.INTERACTING] && !isEmpty(renderedExtent)) {
      let projection = viewState.projection;
      if (!ENABLE_RASTER_REPROJECTION) {
        const sourceProjection = imageSource.getProjection();
        if (sourceProjection) {
          projection = sourceProjection;
        }
      }
      const image = imageSource.getImage(renderedExtent, viewResolution, pixelRatio, projection);
      if (image && this.loadImage(image)) {
        this.image_ = image;
      }
    }

    return !!this.image_;
  }

  /**
   * @inheritDoc
   */
  renderFrame(frameState, target) {
    const image = this.image_;
    const imageExtent = image.getExtent();
    const imageResolution = image.getResolution();
    const imagePixelRatio = image.getPixelRatio();
    const layerState = frameState.layerStatesArray[frameState.layerIndex];
    const pixelRatio = frameState.pixelRatio;
    const viewState = frameState.viewState;
    const viewCenter = viewState.center;
    const viewResolution = viewState.resolution;
    const size = frameState.size;
    const scale = pixelRatio * imageResolution / (viewResolution * imagePixelRatio);

    let width = Math.round(size[0] * pixelRatio);
    let height = Math.round(size[1] * pixelRatio);
    const rotation = viewState.rotation;
    if (rotation) {
      const size = Math.round(Math.sqrt(width * width + height * height));
      width = size;
      height = size;
    }

    // set forward and inverse pixel transforms
    composeTransform(this.pixelTransform,
      frameState.size[0] / 2, frameState.size[1] / 2,
      1 / pixelRatio, 1 / pixelRatio,
      rotation,
      -width / 2, -height / 2
    );
    makeInverse(this.inversePixelTransform, this.pixelTransform);

    const canvasTransform = this.createTransformString(this.pixelTransform);

    this.useContainer(target, canvasTransform, layerState.opacity);

    const context = this.context;
    const canvas = context.canvas;

    if (canvas.width != width || canvas.height != height) {
      canvas.width = width;
      canvas.height = height;
    } else if (!this.containerReused) {
      context.clearRect(0, 0, width, height);
    }

    // clipped rendering if layer extent is set
    let clipped = false;
    if (layerState.extent) {
      const layerExtent = fromUserExtent(layerState.extent, viewState.projection);
      clipped = !containsExtent(layerExtent, frameState.extent) && intersects(layerExtent, frameState.extent);
      if (clipped) {
        this.clipUnrotated(context, frameState, layerExtent);
      }
    }

    const img = image.getImage();

    const transform = composeTransform(this.tempTransform_,
      width / 2, height / 2,
      scale, scale,
      0,
      imagePixelRatio * (imageExtent[0] - viewCenter[0]) / imageResolution,
      imagePixelRatio * (viewCenter[1] - imageExtent[3]) / imageResolution);

    this.renderedResolution = imageResolution * pixelRatio / imagePixelRatio;

    const dx = transform[4];
    const dy = transform[5];
    const dw = img.width * transform[0];
    const dh = img.height * transform[3];

    this.preRender(context, frameState);
    if (dw >= 0.5 && dh >= 0.5) {
      const opacity = layerState.opacity;
      let previousAlpha;
      if (opacity !== 1) {
        previousAlpha = this.context.globalAlpha;
        this.context.globalAlpha = opacity;
      }
      this.context.drawImage(img, 0, 0, +img.width, +img.height,
        Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
      if (opacity !== 1) {
        this.context.globalAlpha = previousAlpha;
      }
    }
    this.postRender(context, frameState);

    if (clipped) {
      context.restore();
    }

    if (canvasTransform !== canvas.style.transform) {
      canvas.style.transform = canvasTransform;
    }

    return this.container;
  }
}

class OlWindy extends Layer {
  constructor(options: any) {
    const baseOptions = Object.assign({}, options);
    delete baseOptions.source;

    super(baseOptions);
  }

  createRenderer() {
    return new OlWindyRenderer(this);
  }

  render(frameState: any, target: HTMLElement) {
    const layerRenderer = this.getRenderer();

    if (layerRenderer.prepareFrame(frameState)) {
      return layerRenderer.renderFrame(frameState, target);
    }
  }
}