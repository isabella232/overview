const debug = require('debug')('lib:searchAndContent');
const directly = require('../helpers/directly');
const cache = require('../helpers/cache');
const fetch = require("node-fetch");
const CAPI_KEY = process.env.CAPI_KEY;
if (!CAPI_KEY) {
    throw new Error('ERROR: CAPI_KEY not specified in env');
}
const CAPI_PATH = 'https://api.ft.com/enrichedcontent/';
const SAPI_PATH = 'https://api.ft.com/content/search/v1';
const CAPI_CONCURRENCE = process.env.hasOwnProperty('CAPI_CONCURRENCE') ? process.env.CAPI_CONCURRENCE : 4;
const defaultAspects = [
	"audioVisual",
	"editorial",
	"images",
	"lifecycle",
	"location",
	"master",
	"metadata",
	"nature",
	"provenance",
	"summary",
	"title"
];
const defaultFacets = [
	"organisations",
	"organisationsId",
	"people",
	"peopleId",
	"topics",
	"topicsId",
	"genre",
	"genreId"
];

const defaultCapiAspects = [
	'id',
	'title',
	'standfirst',
	'summary',
	'firstPublishedDate',
	'publishedDate',
	'prefLabel',
	'types',
	'mergedAnnotations',
	'uuid',
	'mainImage',
];

// NB: should only match basic ontology values, maybe with Id suffix, e.g. people and peopleId,
// and *not* other constraint fields such as lastPublishDateTime
const EntityRegex = /^([a-z]+(?:Id)?):(.+)$/;
function rephraseEntityForQueryString(item) {
    const match = EntityRegex.exec(item);
    if (match) {
        return match[1] + ':"' + match[2] + '"';
    } else {
        return item;
    }
}

// const valid facetNames = [
//   "authors",
//   "authorsId",
//   "brand",
//   "brandId",
//   "category",
//   "format",
//   "genre",
//   "genreId",
//   "icb",
//   "icbId",
//   "iptc",
//   "iptcId",
//   "organisations",
//   "organisationsId",
//   "people",
//   "peopleId",
//   "primarySection",
//   "primarySectionId",
//   "primaryTheme",
//   "primaryThemeId",
//   "regions",
//   "regionsId",
//   "sections",
//   "sectionsId",
//   "specialReports",
//   "specialReportsId",
//   "subjects",
//   "subjectsId",
//   "topics",
//   "topicsId"
// ];

const MAX_maxResults = 100; // baked into SAPI

function constructSAPIQuery(params) {
    const defaults = {
        queryString: '',
        maxResults: 10,
        offset: 0,
        aspects: ['title', 'lifecycle', 'location', 'summary', 'metadata'], // [ "title", "location", "summary", "lifecycle", "metadata"],
        constraints: [],
        facets: { names: ['people', 'organisations', 'topics'], maxElements: -1 }
    };

    const resultContext = (params.hasOwnProperty('resultContext'))? params['resultContext'] : {}; // in case proper SAPI search body is being passed in.
    const combined = Object.assign({}, defaults, resultContext, params);

    if (combined.hasOwnProperty('maxResults')
     && (combined.maxResults > MAX_maxResults || combined.maxResults < 1)) {
      combined.maxResults = MAX_maxResults;
    }

		debug(`constructSAPIQuery: combined=${JSON.stringify(combined)},
		defaults=${JSON.stringify(defaults)},
		resultContext=${JSON.stringify(resultContext)},
		params=${JSON.stringify(params)}`);

    let queryString = combined.queryString;
    if (combined.constraints.length > 0) {
        // NB: not promises...
        queryString = `${combined.queryString} and `;
        queryString += combined.constraints
            .map(c => {
                return rephraseEntityForQueryString(c);
            })
            .join(' and ');
    }

    const full = {
        queryString: queryString,
        queryContext: {
            curations: ['ARTICLES', 'BLOGS']
        },
        resultContext: {
            maxResults: `${combined.maxResults}`,
            offset: `${combined.offset}`,
            aspects: combined.aspects,
            sortOrder: 'DESC',
            sortField: 'lastPublishDateTime',
            facets: combined.facets
        }
    };
    return full;
}

const FetchTimings = {};

function recordFetchTiming(method, timing, resOk, status, statusText) {
    if (!FetchTimings.hasOwnProperty(method)) {
        FetchTimings[method] = [];
    }
    FetchTimings[method].push({
        timing,
        resOk,
        status,
        statusText
    });
}

function summariseFetchTimings(history) {
    const summary = {};
    Object.keys(FetchTimings).forEach(method => {
        const totalCount = FetchTimings[method].length;
        history = history ? history : totalCount;
        const recentFew = FetchTimings[method].slice(-history);
        const count = recentFew.length;
        let statusesNotOk = [];
        let numOk = 0;
        let numNotOk = 0;
        let sum = 0;
        let max = 0;
        let min = -1;
        recentFew.forEach(item => {
            if (item.resOk) {
                numOk = numOk + 1;
            } else {
                numNotOk = numNotOk + 1;
                statusesNotOk.push({
                    status: item.status,
                    statusText: item.statusText
                });
            }

            sum = sum + item.timing;
            max = Math.max(max, item.timing);
            min = min === -1 ? item.timing : Math.min(min, item.timing);
        });
        summary[method] = {
            totalCount: FetchTimings[method].length,
            count,
            mean: sum / count,
            max,
            min,
            numOk,
            numNotOk,
            statusesNotOk
        };
    });

    return summary;
}

function fetchWithTiming(url, options = {}) {
    const startMillis = Date.now();
    return fetch(url, options).then(res => {
        const endMillis = Date.now();
        const timing = endMillis - startMillis;
        return { res, timing };
    });
}

function fetchResText(url, options) {
    return fetchWithTiming(url, options)
        .then(resWithTiming => {
            const method = options && options.method === 'POST' ? 'POST' : 'GET';
            const res = resWithTiming.res;
            const resOk = res && res.ok;
            const timing = resWithTiming.timing;
            recordFetchTiming(method, timing, resOk, res.status, res.statusText);
            if (resOk) {
                return res;
            } else {
                throw new Error(
                    `fetchResText: res not ok: res.status=${
                    res['status']
                    }, res.statusText=${
                    res['statusText']
                    }, url=${url}, options=${JSON.stringify(options)}`
                );
            }
        })
        .then(res => res.text());
}

function cachedFetchResText(path, options) {
	const url=`${path}?apiKey=${CAPI_KEY}`;
  const safeUrl = `${path}?apiKey=...`;
  const keyData = { safeUrl, options };
  const key = JSON.stringify( keyData );

  let cachedValue = cache.get(key);

  if (cachedValue !== undefined) {
    return Promise.resolve(cachedValue);
  }

  return fetchResText( url, options )
  .then( text => {
    cache.set(key, text);
    return text;
  } );
}

function cachedFetchResJson(path, options){
	return cachedFetchResText(path, options)
	.then(text => {
			let sapiObj;
			try {
					sapiObj = JSON.parse(text);
			} catch (err) {
					throw new Error(`cachedFetchResJson: JSON.parse: err=${err},
	text=${text}`);
			}
			return sapiObj;
	})
}

function searchSapi(params) {
		debug(`searchSapi: params=${JSON.stringify(params)}`);
    const sapiQuery = constructSAPIQuery(params);
    const options = {
        method: 'POST',
        body: JSON.stringify(sapiQuery),
        headers: {
            'Content-Type': 'application/json'
        }
    };
    const capiUnaspects = (params.hasOwnProperty('capiUnaspects'))? params['capiUnaspects'] : []; // capi attributes to be discarded
    debug(`searchSapi: sapiQuery=${JSON.stringify(sapiQuery)}`);
    return cachedFetchResJson(SAPI_PATH, options)
        .then(json => {
            return {
                params,
                sapiObj: json
            };
        })
        .then( searchObj => { // look for capi details in here
          if (params.includeCapi) {
            searchObj.sapiObj['capi'] = "including CAPI results";
          } else {
            return searchObj;
          }

          if (!searchObj
            || ! searchObj.sapiObj
            || ! searchObj.sapiObj.results
            || ! searchObj.sapiObj.results.length > 0
            || ! searchObj.sapiObj.results[0].results) {
              return searchObj;
            }

          const uuids = searchObj.sapiObj.results[0].results.map( result => {
            return result.id;
          });

          // get all the articles
          const articlePromisers = uuids.map( uuid => {
                  return function () {
                          return getArticle(uuid); // a fn which returns a promise
                  };
          });

          return directly(CAPI_CONCURRENCE, articlePromisers)
          .then( capiResponses => {

            // prep the article data for integration w/sapi

            const capiResponsesByUuid = {};
            capiResponses.forEach( capiResponse => {
              if (capiResponse
                && capiResponse.id) {

                const id = capiResponse.id;
                const uuid = id.split('/').pop();
                capiUnaspects.forEach( aspect => {
                  delete capiResponse[aspect];
                });
                capiResponse['uuid'] = uuid;

                capiResponsesByUuid[uuid] = capiResponse;
              }
            });

            searchObj.sapiObj.results[0].results.forEach( result => {
              const uuid = result.id;
              if (capiResponsesByUuid.hasOwnProperty(uuid)) {
                result['capi'] = capiResponsesByUuid[uuid];
              }
            } );

            return searchObj;
          })
          ;

        })
        ;
}

const DEFAULT_MAX_SEARCH_DEEPER_DURATION_MS = 3000;
const DEFAULT_MAX_SEARCH_DEPTH = 10;
// maxDepth === 1 => do 1 search, 2 ==> max 2 searches, etc
// maxDurationMs could curtail next iteration
// return list of searchItems
function searchSapiDeeper(params, maxDepth = DEFAULT_MAX_SEARCH_DEPTH) {
    if (maxDepth < 1) {
        return [];
    }
    if (!params.hasOwnProperty('maxDurationMs')) {
        params.maxDurationMs = DEFAULT_MAX_SEARCH_DEEPER_DURATION_MS;
    }
    if (!params.hasOwnProperty('startMs')) {
        params.startMs = Date.now();
    }

    return searchSapi(params)
        .then(searchItem => {
            const sapiObj = searchItem.sapiObj;
            const durationMs = Date.now() - params.startMs;

            searchItem.maxDepth = maxDepth;
            searchItem.offset = sapiObj.query.resultContext.offset;
            searchItem.maxResults = sapiObj.query.resultContext.maxResults;
            searchItem.indexCount = sapiObj.results[0].indexCount;
            searchItem.thisNumResults = (sapiObj.results[0].hasOwnProperty('results'))? sapiObj.results[0].results.length : 0;
            searchItem.remainingResults = Math.max(0, searchItem.indexCount - searchItem.thisNumResults - searchItem.offset);
            searchItem.durationMs = durationMs;

            const searchItems = [searchItem];
            if (
                searchItem.maxDepth < 2
                || searchItem.remainingResults <= 0
                || durationMs >= params.maxDurationMs
            ) {
                debug(`searchDeeper: curtailing: searchItem.maxDepth=${searchItem.maxDepth}, searchItem.remainingResults=${searchItem.remainingResults}, searchItem.indexCount=${searchItem.indexCount}, durationMs=${durationMs}, params.maxDurationMs=${params.maxDurationMs}`);
                return searchItems;
            }

            const nextParams = Object.assign({}, params);
            if (!nextParams.hasOwnProperty('offset')) {
                nextParams.offset = 0;
            }
            nextParams.offset = nextParams.offset + searchItem.maxResults;
            return searchSapiDeeper(nextParams, maxDepth - 1)
                .then(nextSearchItems => searchItems.concat(nextSearchItems))
                ;
        })
        ;
}

const cachedAnnotationsByCsv = {}; // ick. a global var. hangs head in shame. but is useful for later.

function mergeCapiFlavours( capiResponse ){
	// Bridge the gap between old and new capi capiResponses.
	// - Assess whether is new or old (by scanning for key attributes)
	// - compile useful common view of all types of capi
	// - inject into capiResponse as a sort-of-new set

	const annotations = capiResponse.annotations;

	let isNew = true;
	for( let i=0; i<annotations.length; i++ ){
		const anno = annotations[i];
		if (anno.predicate.endsWith('/majorMentions')) {
			isNew = false; break;
		} else if (
			anno.predicate.endsWith('/implicitlyAbout')
	 || anno.predicate.endsWith('/hasDisplayTag')
 		) {
			isNew = true; break;
		}
	}

	const massagedAnnotations = {
		abouts           : [],
		implicitlyAbouts : [],
		mentions         : [],
		classifiedBys    : [],
		implicitlyClassifiedBys : [],
	};
	annotations.forEach( anno => {
		const csv = [anno.type, anno.prefLabel].join(':');
		cachedAnnotationsByCsv[csv] = anno;

		if (anno.type === 'GENRE') {
			massagedAnnotations['genre'] = anno.prefLabel;
		}
		if( anno.predicate.endsWith('/about') ){
			massagedAnnotations.abouts.push(csv);
			if (!isNew) {
				massagedAnnotations['primaryTheme'] = csv;
			}
		} else if( anno.predicate.endsWith('/implicitlyAbout') ){
			massagedAnnotations.implicitlyAbouts.push(csv);
		} else if (anno.predicate.endsWith('/hasDisplayTag')) {
			massagedAnnotations['primaryTheme'] = csv;
			// massagedAnnotations.abouts.push(csv);
		} else if(anno.predicate.endsWith('/majorMentions')) {
			massagedAnnotations.abouts.push(csv);
		} else if(anno.predicate.endsWith('/mentions')) {
			massagedAnnotations.mentions.push(csv);
		} else if(anno.predicate.endsWith('/isClassifiedBy')) {
			massagedAnnotations.classifiedBys.push(csv);
		} else if(anno.predicate.endsWith('/implicitlyClassifiedBy')) {
			massagedAnnotations.implicitlyClassifiedBys.push(csv);
		} else if(anno.predicate.endsWith('/isPrimarilyClassifiedBy')) {
			massagedAnnotations['primarilyClassifiedBy'] = csv;
		}
	});

	return massagedAnnotations;
}

function extractArticles(results) {
	  debug( `extractArticles: num sets of results: ${results.length}` );
    const articles = [];
		const articleSetsSizes = [];
    results.forEach(result => {
				articleSetsSizes.push(result.sapiObj.results[0].results.length);
        result.sapiObj.results[0].results.forEach(article => {
            articles.push(article);
        });
    });
		debug( `extractArticles: articleSetsSizes: ${JSON.stringify(articleSetsSizes)}` );
    return articles;
}

function getCapi(uuid) {
		const options = { method: 'GET' };
		const path = `${CAPI_PATH}${uuid}`;
    return cachedFetchResJson(path, options)
			.then(json => {
				const merged = mergeCapiFlavours(json);
				json['mergedAnnotations'] = merged;
				return json;
			})
	    ;
}

const concertinaNameJoin = ' + ';

function concertinaSortedListAndUpdateUuidGroups( sortedList, uuidsGroupedByItem, params={} ){
  const defaultParams = {
    concertinaOverlapThreshold : 0.66,
  };
  const combinedParams = Object.assign({}, defaultParams, params);

  const concertinaOverlapThreshold = combinedParams.concertinaOverlapThreshold;

  // iterate over sortedByCount (and then over sortedByCountGroupedByTaxonomy)
  // looking to merge annotations, based on overlap of uuids
  // perhaps using an overlap threshold, i.e. if more than 0.5 of the uuids for one anno overlap with those of another, merge the two annos
  // calling the merged annos "anno1+anno2"?
  // Use bubble sort?
  // From smallest count to biggest.
  // Use a knownBubbles map to track (and subsequently ignore) bubbles which make it all the way to the top
  // write fn to work on sorted list of count pairs (creating a new one), and modifying uuidsGroupedByItem (adding new merged items)

  // magic happens
  // - the bubble floats 'up' from the bottom/end of the sorted list
  // - the candidate is the next item in the list that the bubble meets and is assessed for overlap with
  // - assume the bubble is never bigger than the candidate (so any newly merged item needs to be inserted at the appropriate point in the list, as well as the two previous items being removed)
  // - also, don't forget to update uuidsGroupedByItem with the newly merged item's uuids
  // - we check the overlap threshold against the (smaller) bubble

  const concertinaedList = [];
  const sourceList = sortedList.slice();

  // while loop picks off end-most item as the new bubble
  while( sourceList.length > 1 ){
    const bubble      = sourceList.pop();
    const bubbleName  = bubble.name;
    const bubbleUuids = uuidsGroupedByItem[bubbleName];
    const bubbleCount = bubble.count;
    const bubbleConstituentNames = (bubble.hasOwnProperty('constituentNames'))? bubble.constituentNames : [bubbleName];
    // for loop takes the latest bubble and bubbles it up the (remaining) list to look for a match
    for (let i = sourceList.length-1; i>=0; i--) {
      const candidate      = sourceList[i];
      const candidateName  = candidate.name;
      const candidateUuids = uuidsGroupedByItem[candidateName];
      const candidateConstituentNames = (candidate.hasOwnProperty('constituentNames'))? candidate.constituentNames : [candidateName];
      // compute intersection, compare size w/smaller item, decide whether to keep it
      const overlapCount = bubbleUuids.filter( uuid => { return candidateUuids.includes(uuid); }).length;
      if (overlapCount >= bubbleCount*concertinaOverlapThreshold) {
        // create new merged item
        const mergedUuids = Array.from(new Set(candidateUuids.concat(bubbleUuids)));
        const mergedCount = mergedUuids.length;
        const mergedConstituentNames = Array.from(new Set(candidateConstituentNames.concat(bubbleConstituentNames)));
        const mergedName  = mergedConstituentNames.join(concertinaNameJoin);
        const mergedItem  = {
          name             : mergedName,
          count            : mergedCount,
          constituentNames : mergedConstituentNames
        };

        // remove candidate item from list (bubble is already removed)
        sourceList.splice(i,1); // remove candidate from list

        // insert mew merged item appropriately
        let insertJ = i-1; // start from candidate's (former) position
                           // loop until we run out of list, or the next item is bigger
        while (insertJ >= 0 && sourceList[insertJ].count < mergedCount) {
          insertJ -= 1;
        }
        sourceList.splice( insertJ+1, 0, mergedItem);

        // update uuidsGroupedByItem with new merged items's uuids
        uuidsGroupedByItem[mergedName] = mergedUuids;

        // break out of for loop, back into while loop to pick up the end-most item (aka a new bubble)
        break;

      } else if( i === 0) {
        // we have checked the bubble against all the candidates, with no suitable overlap found,
        // so add it to the new concertinaedList (it has already been removed from the sourceList)

        concertinaedList.push(bubble);
      }
    }
  }

  // ensure we don't forget the remining item in the sourceList
  concertinaedList.push(sourceList.pop());
  // ensure the sortedlist is sorted
  concertinaedList.sort( (a,b) => { if (a.count<b.count) { return 1; } else if (a.count>b.count) { return -1; } else { return 0; } });

  return concertinaedList;
}

function concertinaSortedLists( correlations, params={} ){
  // iterate over sortedByCount (and then over sortedByCountGroupedByTaxonomy)

  const uuidsGroupedByItem = correlations.uuidsGroupedByItem;
  const taxonomies = Object.keys( correlations.sortedByCountGroupedByTaxonomy );

  const concertinaedSortedLists = {
    sortedByCount : concertinaSortedListAndUpdateUuidGroups( correlations.sortedByCount, uuidsGroupedByItem, params),
    sortedByCountGroupedByTaxonomy : {},
  }

  taxonomies.forEach( taxonomy => {
    concertinaedSortedLists.sortedByCountGroupedByTaxonomy[taxonomy] = concertinaSortedListAndUpdateUuidGroups( correlations.sortedByCountGroupedByTaxonomy[taxonomy], uuidsGroupedByItem, params);
  });

  return concertinaedSortedLists;
}

// refactor into generic correlation a group selected from each article
function correlateGroupInArticles( fnGetGroupFromArticle, articles, params={} ){

  debug(`correlateGroupInArticles: params=${JSON.stringify(params)}`);

  // should we ignore any group items when extracting the group of items from an article,
  // such as 'PERSON:Donald Trump'

  const ignoreItemList = ((params.hasOwnProperty('ignoreItemList'))? params.ignoreItemList : [])
  .map( item => { return item.toLowerCase(); } );

  debug(`correlateGroupInArticles: ignoreItemList=${JSON.stringify(ignoreItemList)}`);

	const correlations = {
		stats : {
			numArticles     : articles.length,
			undefinedCount  : 0,
			undefinedUuids  : [],
			pubdateEarliest : undefined,
			pubdateLatest   : undefined,
			dateNow : new Date( ).toISOString().split('.')[0] + "000Z",
			description : [
				'undefinedCount refers to the number of articles which did not contain any relevant metadata.',
				'undefinedUuids is the list of uuids of articles which did not contain any relevant metadata.'
			]
		},
		sortedByCount: [], // [{name,count}, ...]
		counts : {}, // [name] = count
		sortedByCountGroupedByTaxonomy : {}, // [taxonomy] = [{name, count}, ...]
		items : [],
		correlations : {}, // [name1][name2] = count
		uuidsGroupedByItem : {}, // [name] = [uuid, uuid, ...]
	};

	let pubdateEarliest, pubdateLatest;
	if (articles.length > 0) {
		pubdateEarliest = pubdateLatest = articles[0].publishedDate;
	}

	articles.forEach( article => {
			pubdateEarliest = (article.publishedDate < pubdateEarliest)? article.publishedDate : pubdateEarliest;
			pubdateLatest = (article.publishedDate > pubdateLatest)? article.publishedDate : pubdateLatest;

      // find all the matching items in the article, and filter out any we should ignore
			let group = fnGetGroupFromArticle(article);

      if (group.length > 0 && group[0] !== undefined) {
        group = group.filter( item => {
          return ! ignoreItemList.includes( item.toLowerCase() );
        });
      }

      // debug( `correlateGroupInArticles: article: group=${JSON.stringify(group)}`);

			if (group.length === 0
				|| (group.length === 1 && group[0] === undefined)) {
				correlations.stats.undefinedCount += 1;
				correlations.stats.undefinedUuids.push(article.uuid);
				return;
			}


			// basic counts of each item, and group uuids by item
			group.forEach( item => {
				if (! correlations.counts.hasOwnProperty(item)) {
					correlations.counts[item] = 0;
				}
				correlations.counts[item] += 1;

				if (! correlations.uuidsGroupedByItem.hasOwnProperty(item)) {
					correlations.uuidsGroupedByItem[item] = [];
				}
				correlations.uuidsGroupedByItem[item].push(article.uuid);
			});

			correlations.sortedByCount = Object.keys(correlations.counts)
			.map( name => { return { name, count: correlations.counts[name] }; } )
			.sort( (a,b) => { if (a.count<b.count) { return 1; } else if (a.count>b.count) { return -1; } else { return 0; } });

			correlations.sortedByCountGroupedByTaxonomy = {};
			correlations.sortedByCount.forEach( itc => {
				const taxonomy = itc.name.split(':')[0];
				if (!correlations.sortedByCountGroupedByTaxonomy.hasOwnProperty(taxonomy)) {
					correlations.sortedByCountGroupedByTaxonomy[taxonomy] = [];
				}
				correlations.sortedByCountGroupedByTaxonomy[taxonomy].push(itc);
			});

			correlations.items = Object.keys(correlations.counts).sort();

			// compute correlations between items in group
			const corrs = correlations.correlations;
			group.forEach( a => {
				group.forEach( b => {
					if (a !== b) {
						if (! corrs.hasOwnProperty(a)   ) { corrs[a]    = {}; }
						if (! corrs[a].hasOwnProperty(b)) { corrs[a][b] = 0;  }
						corrs[a][b] += 1;
					}
				});
			});

      // calc the merged sorted lists
      correlations.concertinaedSortedLists = concertinaSortedLists(correlations, params);

	});

	correlations.stats.pubdateLatest   = pubdateLatest;
	correlations.stats.pubdateEarliest = pubdateEarliest;

	return correlations;
}

function correlateMergedAnnotations( params = {}, articles=[] ){
	const defaultParams = {
		genres : ['News', 'Opinion'],
		groups : ['primaryThemes', 'abouts'],
	}
	const combinedParams = Object.assign({}, defaultParams, params);
  debug(`correlateMergedAnnotations: combinedParams=${JSON.stringify(combinedParams)}`);
	const targetGenres = combinedParams.genres;
	// 	params=${JSON.stringify(params)},
	// 	combinedParams=${JSON.stringify(combinedParams)}`);

	// trim down to just those articles in the specified genres
	const articlesInGenres = articles.filter( article => {
		const genre = article.mergedAnnotations.genre;
		return genre && targetGenres.includes( genre );
	});

	// how to extract the group details from the article as a list of names
	const groupFns = {
		primaryThemes     : a=>{ return [a.mergedAnnotations.primaryTheme]},
		abouts            : a=>{ return a.mergedAnnotations.abouts},
		mentions          : a=>{ return a.mergedAnnotations.mentions},
		aboutsAndMentions : a=>{ return a.mergedAnnotations.abouts.concat(a.mergedAnnotations.mentions) },
	};

	const correlations = {
		genres: combinedParams.genres,
		numArticlesInGenres: articlesInGenres.length,
		groups: {},
	}

	combinedParams.groups.forEach( name => {
		if (groupFns.hasOwnProperty(name)) {
			correlations.groups[name] = correlateGroupInArticles( groupFns[name], articlesInGenres, params );
		}
	})

	return {
		params,
		articles,
		correlations,
	};
}

//---------------------

function getArticle(uuid) {
    return getCapi(uuid)
        .catch(err => {
            return { err: err.message };
        })
        ;
}

function search(params={}){
	params['includeCapi'] = true;
	if (! params.hasOwnProperty('capiUnaspects')) {
		params['capiUnaspects'] = ['bodyXML'];
	}
	return searchSapi(params)
	.then( sapiObj => {
		return {
			description: 'a SAPI call followed by a CAPI call for each article result, named capi in the article. Full results.',
			params,
			sapiObj,
		}
	})
	.catch( err => {
		return { err: err.message };
	})
	;
}

function searchDeeper(params={}){
	params['includeCapi'] = true;
	if (! params.hasOwnProperty('capiUnaspects')) {
		params['capiUnaspects'] = ['bodyXML'];
	}
	const maxDepth = (params.hasOwnProperty('maxDepth')) ? params['maxDepth'] : 2;
	return searchSapiDeeper(params,maxDepth)
	.then( sapiObjs => {
		return {
			description: 'a SAPI call followed by a CAPI call for each article result, named capi in the article. Search is iterated if there are more results. Full results.',
			params,
			maxDepth,
			sapiObjs,
		}
	})
	.catch( err => {
		return { err: err.message };
	})
	;
}

function searchDeeperArticles(params={}){
  const searchStats = {};
	return searchDeeper(params)
	.then( sdResult => {
		if (sdResult.hasOwnProperty('err')) {
			throw new Error( sdResult.err );
		}
		return sdResult.sapiObjs;
	})
	.then( sapiObjList => {
    searchStats.numSearches = sapiObjList.length;
    if (searchStats.numSearches>0) {
      searchStats.indexCount = sapiObjList[0].indexCount;
    } else {
      searchStats.indexCount = 0;
    }
		return extractArticles(sapiObjList);
	})
	.then( articles => {
		const filteredArticles = articles.map( article => {
			const capi = article.capi;
			const filteredCapi = {};
			defaultCapiAspects.forEach(aspect => {
				filteredCapi[aspect] = capi[aspect];
			});

			article.capi = filteredCapi;
			return article;
		});
		return articles;
	})
	.then( articles => {
		return {
			description: 'a series of SAPI calls followed by a CAPI call for each article result, named capi in the article, then filtered down to just be a merged list of articles.',
			params,
			numArticles : articles.length,
			articles,
      searchStats,
		}
	})
	.catch( err => {
		return { err: err.message };
	})
	;
}

function searchDeeperArticlesCapi(params={}){
  let searchStats;
	return searchDeeperArticles(params)
	.then( sdaResult => {
		if (sdaResult.hasOwnProperty('err')) {
			throw new Error( sdaResult.err );
		}
    searchStats = sdaResult.searchStats;
		return sdaResult.articles;
	})
	.then( articles => {
		const justCapis = articles.map( article => {
			return article.capi;
		});

		return {
			description : 'just the CAPI portions of the SAPI/CAPI results',
			params,
			numArticles : justCapis.length,
			articles : justCapis,
      searchStats,
		};
	})
	.catch( err => {
		return { err: err.message };
	})
	;
}

function correlateDammit(params={}){
  debug(`correlateDammit: params=${JSON.stringify(params)}`);
  let searchStats;
	return searchDeeperArticlesCapi(params)
	.then( sResult => {
		if (sResult.hasOwnProperty('err')) {
			throw new Error( sResult.err );
		}
    searchStats = sResult.searchStats;
		return sResult.articles;
	})
	.then( articles => {
		return correlateMergedAnnotations( params, articles );
	})
	.then( correlationsObj => {
		const correlations = correlationsObj.correlations;
		const articles     = correlationsObj.articles;
		const articlesByUuid = {};
		articles.forEach( article => { articlesByUuid[article.uuid] = article; });
		const annotationsByCsv = {}; // loop over all the groups to get the csvs, and pull in their anno details from from cachedAnnotationsByCsv
		Object.keys(correlations.groups).forEach( groupName => {
			correlations.groups[groupName].items.forEach( csv => {
				annotationsByCsv[csv] = cachedAnnotationsByCsv[csv];
			});
		});

		return {
			description : 'correlating the CAPI portions of the SAPI/CAPI results',
			params,
			numArticles : articles.length,
			correlations,
			articlesByUuid,
			annotationsByCsv,
      searchStats,
		};
	})
	.catch( err => {
    const message = err.message.replace( /apiKey=[a-zA-z0-9\-]+/g, 'apiKey=...');
    throw new Error(`correlateDammit: ${message}`);
	})
	;
}

const EARLIEST_YEAR = 2010;

function calcFullDateRange( year=null ){
  const fromYear = (year == null)? EARLIEST_YEAR : year;
  const defaultEarliestDateTime = `${fromYear}-01-01T00:00:00Z`;
  const today = (year == null)? new Date() : new Date( `${year}-12-31` );
  today.setHours(23,59,59,0);
  const todayIsoStringNoMillis = today.toISOString().replace('.000', '');
  const queryString = `lastPublishDateTime:>${defaultEarliestDateTime} and lastPublishDateTime:<${todayIsoStringNoMillis}`;

  return {
    earliestYear: EARLIEST_YEAR,
    after: defaultEarliestDateTime,
    before: todayIsoStringNoMillis,
    queryString,
  }
}

function allFacets(params={}){
  const fulDateRange = calcFullDateRange();
  const ontologies = ['people', 'organisations', 'topics'];
  const defaultParams = {
    queryString : fulDateRange.queryString,
    maxResults  : 1,
    aspects     : ['title','metadata'],
    facets      : { names: ontologies, maxElements: -1 },
  }

  const combinedParams = Object.assign(defaultParams, params);
  debug(`allFacets: combinedParams=${JSON.stringify(combinedParams)}`);

  return searchSapi(combinedParams)
  .then(searchItem => {
    // debug(`allFacets: searchItem=${JSON.stringify(searchItem, null, 2)}`);
    searchItem.lastPublishDateTime = {
      after : fulDateRange.after,
      before: fulDateRange.before,
    }
    searchItem.description = 'returning the counts of all facets of the specified ontologies tagged in articles in the specified data range';
    searchItem.articleCount = -1; // placeholder so these attributes appear first in json
    searchItem.ontologyNames = ontologies;
    searchItem.ontologiesStats = {};
    searchItem.ontologies = {};

    if ( searchItem
      && searchItem.sapiObj
      && searchItem.sapiObj.results
      && searchItem.sapiObj.results[0]
      && searchItem.sapiObj.results[0].facets
    ) {
      searchItem.articleCount = searchItem.sapiObj.results[0].indexCount;
      const resultsFacets = searchItem.sapiObj.results[0].facets;
      resultsFacets.forEach( facets => {
        const ontology = facets.name;
        searchItem.ontologiesStats[ontology] = {};
        searchItem.ontologiesStats[ontology].count = facets.facetElements.length;
        searchItem.ontologies[ontology] = {};
        facets.facetElements.forEach( facetElement => {
          searchItem.ontologies[ontology][facetElement.name] = facetElement.count;
        });
      })
    }

    searchItem.sapiObj = '...';

    return searchItem;
  })
  ;
}

async function allFacetsByYear(){
  const today = new Date();
  const thisYear = today.getFullYear();
  const facetsByYear = {
    description: 'looking at counts of each ontology value by year',
    yearRange: {
      from: EARLIEST_YEAR,
      to: thisYear
    },
    years: [],
    ontologies: [],
    ontologiesNamesByYear: {},
    allFacets: await allFacets(),
  };

  facetsByYear.ontologies = facetsByYear.allFacets.ontologyNames;


  for (let year = EARLIEST_YEAR; year <= thisYear; year++) {
    facetsByYear.years.push(year);
    const fullDateRange = calcFullDateRange(year);
    const params = { queryString: `lastPublishDateTime:>${fullDateRange.after} and lastPublishDateTime:<${fullDateRange.before}` };
    const searchItem = await allFacets(params);
    // searchItem.ontologies[ontology][facetElement.name] = facetElement.count;
    for (let [ontology, namesCounts] of Object.entries(searchItem.ontologies)) {
      if (!facetsByYear.ontologiesNamesByYear.hasOwnProperty(ontology)) {
        facetsByYear.ontologiesNamesByYear[ontology] = {};
      }
      for (let [name, count] of Object.entries(searchItem.ontologies[ontology])) {
        if (! facetsByYear.ontologiesNamesByYear[ontology][name]) {
          facetsByYear.ontologiesNamesByYear[ontology][name] = {};
        }
        facetsByYear.ontologiesNamesByYear[ontology][name][year] = count;
      }
    }
  }
  return facetsByYear;
}

module.exports = {
	search,
	searchDeeper,
	searchDeeperArticles,
	searchDeeperArticlesCapi,
	getArticle,
	summariseFetchTimings,
	correlateDammit,
  allFacets,
  allFacetsByYear,
  calcFullDateRange,
};
