const express = require('express');
const router = express.Router();
const sapiV1CapiV2 = require('../lib/sapiV1CapiV2');
const debug = require('debug')('views:year');
const image = require('../helpers/image');


router.get('/', (req, res, next) => {
  res.render("year");
});

function constructQueryParamsForYearTopicCounts( year=2018 ){
  const queryString = [
    `lastPublishDateTime:>${year}-01-01T00:00:00Z`,
    `lastPublishDateTime:<${year+1}-01-01T00:00:00Z`
  ].join(' and ');

  const queryParams = {
    queryString,
    maxResults : 1,
    includeCapi: false,
  };

  return queryParams;
}

function fetchSapiTopicSummary( year ){
  const queryParams = constructQueryParamsForYearTopicCounts( year );
  sapiV1CapiV2.search
  return sapiV1CapiV2.search( queryParams )
  .then( sapiResult => {
    const v1AnnosByTaxonomy = {};

    if ( sapiResult
      && sapiResult.sapiObj
      && sapiResult.sapiObj.sapiObj
      && sapiResult.sapiObj.sapiObj.results
      && sapiResult.sapiObj.sapiObj.results.length > 0
      && sapiResult.sapiObj.sapiObj.results[0]
      && sapiResult.sapiObj.sapiObj.results[0].facets
    ) {
      sapiResult.sapiObj.sapiObj.results[0].facets.forEach( facet => {
        const taxonomy = facet.name;
        if (!v1AnnosByTaxonomy.hasOwnProperty(taxonomy)) {
          v1AnnosByTaxonomy[taxonomy] = [];
        }
        facet.facetElements.forEach(element => {
          element.nameCsv = `${taxonomy}:${element.name}`;
          v1AnnosByTaxonomy[taxonomy].push(element);
        });
      })
    }

    return v1AnnosByTaxonomy;
  })
  .then( v1AnnosByTaxonomy => {
    return {
      year,
      v1AnnosByTaxonomy
    }
  })
  ;
}

router.get('/topics/:year', async (req, res, next) => {
	 try {
     const year = req.params.year;
	   const searchResponse = await fetchSapiTopicSummary( Number(year) );
	   res.json( searchResponse );
   } catch( err ){
     res.json( { error: err.message, });
   }
});

router.get('/topics/:year1/:year2', (req, res, next) => {
	 try {
     const years = [ Number(req.params.year1), Number(req.params.year2) ].sort();
     const searchPromises = years.map( year => { return fetchSapiTopicSummary(year); });
     Promise.all(searchPromises)
     .then( data => {
       res.json( data );
     })
     .catch( err => {
       throw err;
     })
   } catch( err ){
     res.json( { error: err.message, });
   }
});

function compareYearsTopics( searchResponses ){
  const combinedByTaxonomy = {};
  const years = searchResponses.map( r => { return r.year; } );
  searchResponses.forEach( (searchResponse, responseIndex) => {
    const year = searchResponse.year;
    const taxonomies = Object.keys( searchResponse.v1AnnosByTaxonomy );
    taxonomies.forEach( taxonomy => {
      if (!combinedByTaxonomy.hasOwnProperty(taxonomy)) {
        combinedByTaxonomy[taxonomy] = {};
      }
      const taxonomyAnnos = combinedByTaxonomy[taxonomy];
      searchResponse.v1AnnosByTaxonomy[taxonomy].forEach( anno => {
        const name = anno.name;
        if (! taxonomyAnnos.hasOwnProperty(name)) {
          taxonomyAnnos[name] = {
            name,
            nameCsv: anno.nameCsv,
            counts : [0,0]
          };
        }
        taxonomyAnnos[name].counts[responseIndex] = anno.count;
      });

      const names = Object.keys(taxonomyAnnos);
      names.forEach( name => {
        const anno = taxonomyAnnos[name];
        const maxCount = Math.max( ...anno.counts );
        const minCount = Math.min( ...anno.counts );
        const delta = anno.counts[1] - anno.counts[0];
        const fractionDelta = delta / maxCount;

        anno.maxCount = maxCount;
        anno.minCount = minCount;
        anno.delta = delta;
        anno.fractionDelta = fractionDelta;
        anno.absFractionDelta = Math.abs( fractionDelta );
      })
    });
  });

  return {
    years,
    combinedByTaxonomy
  };
}

router.get('/topics/compare/:year1/:year2', (req, res, next) => {
	 try {
     const years = [ Number(req.params.year1), Number(req.params.year2) ].sort();
     const searchPromises = years.map( year => { return fetchSapiTopicSummary(year); });
     Promise.all(searchPromises)
     .then( searchResponses => {
       return compareYearsTopics(searchResponses);
     })
     .then( data => {
       res.json( data );
     })
     .catch( err => {
       throw err;
     })
   } catch( err ){
     res.json( { error: err.message, });
   }
});

const defaultComparisonParams = {
  minCount : 20,
  minFractionDelta : 0.2
};

function classifyComparedTopics( comparedTopics ){
  const classificationsByTaxonomy = {};
  const taxonomies = Object.keys( comparedTopics.combinedByTaxonomy );
  const categories = ['newKids','increasing','decreasing','deadToUs','littleChange'];
  taxonomies.forEach( taxonomy => {
    classificationsByTaxonomy[taxonomy] = {};
    categories.forEach( category => { classificationsByTaxonomy[taxonomy][category] = []; });
    const annoNames = Object.keys( comparedTopics.combinedByTaxonomy[taxonomy] );
    annoNames.forEach( name => {
      const anno = comparedTopics.combinedByTaxonomy[taxonomy][name];
      const maxCount         = anno.maxCount;
      const minCount         = anno.minCount;
      const delta            = anno.delta;
      const fractionDelta    = anno.fractionDelta;

      if (maxCount >= defaultComparisonParams.minCount){
        if (fractionDelta <= - defaultComparisonParams.minFractionDelta) {
          if( minCount === 0 ){
            classificationsByTaxonomy[taxonomy].deadToUs.push(anno);
          } else {
            classificationsByTaxonomy[taxonomy].decreasing.push(anno);
          }
        } else if (fractionDelta >= defaultComparisonParams.minFractionDelta) {
          if (minCount === 0) {
            classificationsByTaxonomy[taxonomy].newKids.push(anno);
          } else {
            classificationsByTaxonomy[taxonomy].increasing.push(anno);
          }
        } else {
          classificationsByTaxonomy[taxonomy].littleChange.push(anno);
        }
      }
    });

    categories.forEach( category => {
      classificationsByTaxonomy[taxonomy][category].sort( (a,b) => {
        if( a.absFractionDelta > b.absFractionDelta ){
          return -1;
        }
        else if( a.absFractionDelta < b.absFractionDelta ){
          return +1;
        }
        else {
          if( a.maxCount > b.maxCount ){ return -1; }
          else if( a.maxCount < b.maxCount ){ return +1; }
          else { return 0; }
       };
      });
    });

  });

  return {
    description: [
      'comparing topic counts across two years, grouped by taxonomy',
      `classifying into ${categories.join(', ')}`,
      'ignoring small topics',
      'sorted by biggest proportional change'
    ],
    years : comparedTopics.years,
    categories,
    taxonomies,
    classificationsByTaxonomy,
    comparisonParams: defaultComparisonParams
  };
}

function getAndConstructClassifications( years ){
  const searchPromises = years.map( year => { return fetchSapiTopicSummary(year); });
  return Promise.all(searchPromises)
  .then( searchResponses => {
    return compareYearsTopics(searchResponses);
  })
  .then( comparisons => {
    return classifyComparedTopics( comparisons );
  })
  .catch( err => {
    throw err;
  })
  ;
}

router.get('/topics/classify/:year1/:year2', (req, res, next) => {
	 try {
     const years = [ Number(req.params.year1), Number(req.params.year2) ].sort();
     const searchPromises = years.map( year => { return fetchSapiTopicSummary(year); });
     getAndConstructClassifications(years)
     .then( data => {
       res.json( data );
     })
     ;
   } catch( err ){
     res.json( { error: err.message, });
   }
});

function prepDisplayData( year1, year2, classifications ){
  const byTaxonomy = classifications.taxonomies.map( taxonomy => {
    const byCategory = classifications.categories.map( category => {
      return {
        category,
        items : classifications.classificationsByTaxonomy[taxonomy][category]
      }
    });
    return {
      taxonomy,
      byCategory
    };
  });

  return {
    year1: year1,
    year2: year2,
    taxonomies: classifications.taxonomies,
    categories: classifications.categories,
    byTaxonomy
  };
}

router.get('/topics/classify/display/:year1/:year2', (req, res, next) => {
	 try {
     const years = [ Number(req.params.year1), Number(req.params.year2) ].sort();
     const searchPromises = years.map( year => { return fetchSapiTopicSummary(year); });
     getAndConstructClassifications(years)
     .then( classifications => {
       return prepDisplayData( years[0], years[1], classifications);
     })
     .then( data => {
       res.json( data );
     })
     ;
   } catch( err ){
     res.json( { error: err.message, });
   }
});

router.get('/display/:template', async (req, res, next) => {
	 try {
     const template = req.params.template;
     const years = [ Number(req.query.year1), Number(req.query.year2) ].sort();
     const classifications = await getAndConstructClassifications(years);
     const data = prepDisplayData( years[0], years[1], classifications );
     res.render(`yearViews/${template}`, {
       data,
     });

   } catch( err ){
     res.json( { error: err.message, });
   }
});

module.exports = router;
