var gulp    = require('gulp')
var concat  = require('gulp-concat');
var sass    = require('gulp-ruby-sass');
var connect = require('gulp-connect');
var sourcemaps = require('gulp-sourcemaps');
var autoprefixer = require('gulp-autoprefixer');
var exec    = require('child_process').exec;


gulp.task('templates',function(cb){
  exec('node node_modules/gulp-hogan/node_modules/hogan.js/bin/hulk src/templates/{,**/}*.hgn > src/javascript/templates.js', function(err) {
    if (err) return cb(err); // return error
    cb(); // finished task
  });
})

gulp.task('js',['templates'], function(){

    gulp.src([
        'node_modules/gulp-hogan/node_modules/hogan.js/web/builds/3.0.2/hogan-3.0.2.js',
        'src/javascript/templates.js',
        'src/javascript/*.js'
      ])
      .pipe(sourcemaps.init())
        .pipe(concat('scripts.js'))
      .pipe(sourcemaps.write())
      .pipe(gulp.dest("dist"))
      .pipe(connect.reload());
})

/*
**  Compile css - this is consistent across the board so no separation required
*/
gulp.task('sass',function(){
  return sass('src/sass/styles.scss')
    .on('error', function (err) {
        console.error('Error!', err.message);
    })
    .pipe(autoprefixer({
        browsers: ['last 2 versions'],
        cascade: false
    }))
    .pipe(gulp.dest('dist/'))
    .pipe(connect.reload());
})

/*
** Server for Desktop app
*/
gulp.task('connect', function() {
  connect.server({
    root:'dist/',
    livereload : true
  });
});


gulp.task('watch',function(){
  gulp.watch(['src/javascript/**/*.js', 'src/templates/*.hgn'],['js']);
  gulp.watch(['src/sass/*.scss','src/sass/**/*.scss'],['sass']);
  gulp.watch('src/icons/*.sketch', { debounceDelay: 3000 }, ['icons']); // wait 3 sec after the last run
})

gulp.task('default',['js', 'sass', 'connect', 'watch']);
