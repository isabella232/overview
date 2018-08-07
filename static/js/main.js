var main = document.getElementsByTagName('main')[0];

function status(response) {
	if (response.status >= 200 && response.status < 300) {
		return Promise.resolve(response)
	} else {
		return Promise.reject(new Error(response.statusText))
	}
}

function json(response) {
	return response.json()
}

function infoWrapper(element){
	var output = '';
	var filterdData = getRequiredInfo(element);

	output += '<div class="item">' + domWrap('p', filterdData.title) + '</div>'

	return output;
}

function domWrap(tag, content){
	return '<' + tag + '>' + content + '</' + tag + '>';
}

function getRequiredInfo(element){
	return {
		'title' : getTitle(element),
		//'subheading' : getSubheading(element),
	}
}

function getTitle(obj){
	return sliceQuotes(JSON.stringify(obj.title.title, null, 2));
}

function getSubheading(obj){
	return sliceQuotes(JSON.stringify(obj.editorial.subheading, null, 2));
}

function sliceQuotes(str){
	//should check if the first and last characters are actually quotation marks before removing
	return str.substr(1).slice(0, -1);
}