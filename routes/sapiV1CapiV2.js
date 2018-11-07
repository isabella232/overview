const express = require('express');
const router = express.Router();
const sapiV1CapiV2 = require('../lib/sapiV1CapiV2');
const debug = require('debug')('views:sapiV1CapiV2');

// set up in index.js, so not needed here
// const bodyParser = require('body-parser');
// // support parsing of application/json type post data
// app.use(bodyParser.urlencoded({ extended: false }));
// app.use(bodyParser.json());

router.get("/", (req, res, next) => {
  res.render("sapiV1CapiV2");
});

function constructSearchParamsFromRequest( urlParams={}, bodyParams={} ){
	const params = {};
	// string params
  // ['queryString', 'apiKey'].forEach( name => {
  ['queryString'].forEach( name => {
		if (urlParams.hasOwnProperty(name) && urlParams[name] !== "") {
			params[name] = urlParams[name];
		}
	});
	// int params
	['maxResults', 'offset', 'maxDepth'].forEach( name => {
		if (urlParams.hasOwnProperty(name) && urlParams[name] !== "") {
			params[name] = Number( urlParams[name] );
		}

    if (bodyParams.hasOwnProperty(name) && typeof bodyParams[name] !== 'number') {
      bodyParams[name] = Number(bodyParams[name]);
    }
	});
	// boolean params
	['includeCapi'].forEach( name => {
		if (urlParams.hasOwnProperty(name) && urlParams[name] !== "") {
			params[name] = Boolean( urlParams[name] );
		}
	});
  // string list params
  ['genres', 'groups'].forEach( name => {
    if (urlParams.hasOwnProperty(name) && urlParams[name] !== "") {
      params[name] = urlParams[name].split(',');
    }
    if (bodyParams.hasOwnProperty(name) && typeof bodyParams[name] == 'string') {
      bodyParams[name] = bodyParams[name].split(',');
    }
  });

  const combinedParams = Object.assign( {}, bodyParams, params ); // because body-parser creates req.body which does not have hasOwnProperty()... yes, really

  debug(`constructSearchParamsFromRequest: combinedParams=${JSON.stringify(combinedParams)},
  urlParams=${JSON.stringify(urlParams)},
  bodyParams=${JSON.stringify(bodyParams)}`);

	return combinedParams;
}

const pathsFns = [
  ['/search'                      , sapiV1CapiV2.search                  ],
  ['/search/deeper'               , sapiV1CapiV2.searchDeeper            ],
  ['/search/deeper/articles'      , sapiV1CapiV2.searchDeeperArticles    ],
  ['/search/deeper/articles/capi' , sapiV1CapiV2.searchDeeperArticlesCapi],
  ['/correlateDammit'             , sapiV1CapiV2.correlateDammit         ],
];

// unpack all the combinations of get/post for each of the main routes
['get', 'post'].forEach( method => {
  pathsFns.forEach( pathFnPair => {
    const path = pathFnPair[0];
    const fn   = pathFnPair[1];

    debug(`sapiV1CapiV2:routes: method=${method}, path=${path}, fn=${fn.name}`);

    router[method](path, async (req, res, next) => {
      try {
        const bodyParams = (req.body)? Object.assign({}, req.body) : {};
      	const combinedParams = constructSearchParamsFromRequest( req.query, bodyParams );
      	const searchResponse = await fn( combinedParams );
      	res.json( searchResponse );
      } catch( err ){
        res.json( {
          error: err.message,
          path
        });
      }
    });

  });
});

router.get('/getArticle/uuid', async (req, res, next) => {
	 try {
     const uuid = req.params.uuid;
	   const searchResponse = await sapiV1CapiV2.getArticle( uuid );
	   res.json( searchResponse );
   } catch( err ){
     res.json( { error: err.message, });
   }
});

router.get('/getArticle', async (req, res, next) => {
	 try {
     const uuid = req.query.uuid;
     if (! uuid) {
       throw new Error( '/getArticle: must specify a uuid, as either a query param (?uuid=...) or a path param (/getArticle/...)');
     }
	   const searchResponse = await sapiV1CapiV2.getArticle( uuid );
	   res.json( searchResponse );
   } catch( err ){
     res.json( { error: err.message, });
   }
});

router.get('/summariseFetchTimings', async (req, res, next) => {
	 try {
     const lastFew = (req.query.hasOwnProperty('lastFew'))? Number(req.query['lastfew']) : 0;
	   const summary = sapiV1CapiV2.summariseFetchTimings( lastFew );
	   res.json( summary );
   } catch( err ){
     res.json( { error: err.message, });
   }
});

router.get('/test', async (req, res, next) => {
	res.json({
		test: true,
	});
});

module.exports = router;
