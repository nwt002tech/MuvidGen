import {
	Loader
} from '../../../build/three.module.js';

import { Font } from '../core/Font.js';

/**
 * https://github.com/mrdoob/three.js/blob/master/examples/jsm/loaders/FontLoader.js
 */

class FontLoader extends Loader {

	constructor( manager ) {

		super( manager );

	}

	load( url, onLoad, onProgress, onError ) {

		const scope = this;

		const loader = new this.constructor.DefaultFileLoader( this.manager );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, function ( text ) {

			let json;

			try {

				json = JSON.parse( text );

			} catch ( e ) {

				if ( onError ) onError( e );

				console.error( 'THREE.FontLoader: Can\'t parse ' + url + '.', e );

				return;

			}

			const font = scope.parse( json );

			if ( onLoad ) onLoad( font );

		}, onProgress, onError );

	}

	parse( json ) {

		return new Font( json );

	}

}

export { FontLoader };
