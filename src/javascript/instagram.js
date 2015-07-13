var clientId = '7304c4d57e6f42ed85f01d60fda52a2b';
var accessToken = '2049417506.7304c4d.8f36d0fc98bc4f688e7a17fec4d728bc';

$(function(){
	var gallery = $('#gallery');
  get().done(function(resp){
  	$.each(resp.data,function(){
  		gallery.append(templates.item.render(this));
  	})
  	$("video").prop("volume", 0);
  });
})

var get = function(){
	return $.ajax({
		type: "GET",
        dataType: "jsonp",
        url : 'https://api.instagram.com/v1/users/self/media/recent?access_token=2049417506.1fb234f.5325325fc24f468f8a8621c1a39a5ce0&count=30'
	})
}

