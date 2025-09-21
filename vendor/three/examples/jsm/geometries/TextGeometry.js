import {
	ExtrudeGeometry
} from '../../../build/three.module.js';

import { Font } from '../core/Font.js';

/**
 * https://github.com/mrdoob/three.js/blob/master/examples/jsm/geometries/TextGeometry.js
 */

class TextGeometry extends ExtrudeGeometry {

	constructor( text, parameters = {} ) {

		const font = parameters.font;

		if ( ! ( font && font.isFont ) ) {

			console.error( 'THREE.TextGeometry: font parameter is not an instance of THREE.Font.' );
			super(); // generate empty geometry

		} else {

			const shapes = font.generateShapes( text, parameters.size );

			// translate parameters to ExtrudeGeometry API

			parameters.depth = parameters.height !== undefined ? parameters.height : 50;

			// defaults

			if ( parameters.bevelThickness === undefined ) parameters.bevelThickness = 10;
			if ( parameters.bevelSize === undefined ) parameters.bevelSize = 8;
			if ( parameters.bevelEnabled === undefined ) parameters.bevelEnabled = false;

			super( shapes, parameters );

		}

		this.type = 'TextGeometry';

	}

}

export { TextGeometry };
